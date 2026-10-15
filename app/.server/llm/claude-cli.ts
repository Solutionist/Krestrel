// Claude via the user's own, unmodified Claude Code CLI and Claude subscription (ADR 0012).
// Krestrel never sees, stores, or forwards Claude credentials: the CLI handles sign-in itself,
// which is the use Anthropic's legal page explicitly allows (code.claude.com/docs/en/legal-and-compliance).
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Logger } from "pino";
import * as z from "zod";

import { parseConfig } from "../env-schema";
import { type ResolvedCommand, resolveWindowsCommand } from "./resolve-command";
import { type LlmClient, LlmError, type StructuredRequest, type StructuredResult } from "./types";

const ClaudeCliConfigSchema = z.object({
  CLAUDE_CLI_PATH: z.string().min(1).default("claude"),
  /** e.g. "sonnet" or "opus"; unset uses the CLI's default for your plan. */
  CLAUDE_MODEL: z.string().min(1).optional(),
  CLAUDE_TIMEOUT_MS: z.coerce.number().int().min(10_000).max(600_000).default(180_000),
});

/** `claude -p --output-format json` result envelope (only the fields Krestrel reads). */
const EnvelopeSchema = z.looseObject({
  is_error: z.boolean().optional(),
  result: z.string().optional(),
  structured_output: z.unknown().optional(),
  modelUsage: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Environment passed to the CLI: enough to find its install and the user's sign-in (HOME or
 * USERPROFILE, macOS keychain via USER, Windows APPDATA/SystemRoot), nothing of Krestrel's (no
 * Alpaca keys, no DATABASE_URL, and no ANTHROPIC_API_KEY, which would silently switch billing from
 * the subscription to the API).
 */
const PASSTHROUGH_ENV = [
  "HOME",
  "USER",
  "LOGNAME",
  "PATH",
  "SHELL",
  "LANG",
  "TMPDIR",
  "XDG_CONFIG_HOME",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
  "SystemRoot",
  "TEMP",
  "TMP",
];

export interface SpawnResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  /** Set when the executable could not be started at all (e.g. ENOENT). */
  spawnError: NodeJS.ErrnoException | null;
}

export type RunProcess = (
  command: string,
  args: readonly string[],
  options: { stdin: string; cwd: string; env: NodeJS.ProcessEnv; timeoutMs: number },
) => Promise<SpawnResult>;

const runProcess: RunProcess = (command, args, options) => {
  let resolved: ResolvedCommand = { command, args: [] };
  if (process.platform === "win32") {
    try {
      resolved = resolveWindowsCommand(command, options.env.PATH);
    } catch (error) {
      const spawnError = error as NodeJS.ErrnoException;
      return Promise.resolve({ code: null, stdout: "", stderr: "", timedOut: false, spawnError });
    }
  }
  const { promise, resolve } = Promise.withResolvers<SpawnResult>();
  const child = spawn(resolved.command, [...resolved.args, ...args], {
    cwd: options.cwd,
    env: options.env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  let timedOut = false;
  let spawnError: NodeJS.ErrnoException | null = null;
  // SIGINT lets Claude Code end its turn cleanly (SIGTERM leaves it unfinished, exit 143).
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill("SIGINT");
  }, options.timeoutMs);
  child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
    stderr += chunk;
  });
  child.on("error", (error: NodeJS.ErrnoException) => {
    spawnError = error;
  });
  child.on("close", (code) => {
    clearTimeout(timer);
    resolve({ code, stdout, stderr, timedOut, spawnError });
  });
  child.stdin.on("error", () => {
    // The process exited before reading stdin; the close handler reports why.
  });
  child.stdin.end(options.stdin);
  return promise;
};

/**
 * JSON Schema for `--json-schema`. The CLI rejects Zod's default `$schema` (draft 2020-12 meta
 * schema URI, "no schema with key or ref"), so emit draft-07 and drop the `$schema` key.
 */
export function cliJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const { $schema: _metaSchema, ...rest } = z.toJSONSchema(schema, { target: "draft-7" });
  return rest;
}

/** Maps a CLI-reported failure message to a code and UI copy. */
function classifyFailure(message: string): LlmError {
  const text = message.toLowerCase();
  if (/(oauth|login|log in|sign in|authenticat|credential|api key)/.test(text)) {
    return new LlmError(
      "not_signed_in",
      "Claude Code isn't signed in. Open a terminal, run `claude`, use /login with your Claude account, then try again.",
    );
  }
  if (/(rate limit|usage limit|limit reached|quota|overloaded)/.test(text)) {
    return new LlmError(
      "rate_limited",
      "Your Claude usage limit is reached or Claude is busy. Try again later.",
    );
  }
  return new LlmError("failed", `Claude Code reported an error: ${message.slice(0, 200)}`);
}

export interface ClaudeCliDeps {
  run: RunProcess;
  /** Empty working directory so no project CLAUDE.md, hooks, or MCP servers are loaded. */
  scratchDir: string;
}

export function createClaudeCliClient(
  context: { env: Readonly<Record<string, string | undefined>>; logger: Logger },
  deps: Partial<ClaudeCliDeps> = {},
): LlmClient {
  const config = parseConfig(ClaudeCliConfigSchema, context.env, "Claude CLI");
  const log = context.logger.child({ mod: "claude-cli" });
  const run = deps.run ?? runProcess;
  const scratchDir = deps.scratchDir ?? join(tmpdir(), "krestrel-claude");
  let inFlight = false;

  return {
    id: "claude-cli",
    displayName: "Claude (your subscription via Claude Code)",

    async generateStructured<T extends z.ZodType>(
      request: StructuredRequest<T>,
    ): Promise<StructuredResult<z.output<T>>> {
      // One analysis at a time: protects the subscription's limits from double clicks.
      if (inFlight)
        throw new LlmError(
          "busy",
          "Claude is already working on a request. Wait for it to finish.",
        );
      inFlight = true;
      try {
        mkdirSync(scratchDir, { recursive: true });
        // A per-request choice (the owner's model picker) wins over CLAUDE_MODEL.
        const model = request.model ?? config.CLAUDE_MODEL;
        const timeoutMs = request.timeoutMs ?? config.CLAUDE_TIMEOUT_MS;
        // Only the tools this request names: available (--tools) and pre-approved for headless
        // use (--allowedTools). Without any, a pure text-in, JSON-out call.
        const tools = (request.tools ?? []).join(",");
        const args = [
          "-p",
          "--output-format",
          "json",
          "--json-schema",
          JSON.stringify(cliJsonSchema(request.schema)),
          "--system-prompt",
          request.system,
          // No MCP servers, skills, or saved session beyond the requested built-in tools.
          "--tools",
          tools,
          ...(tools ? ["--allowedTools", tools] : []),
          "--strict-mcp-config",
          "--disable-slash-commands",
          "--no-session-persistence",
          ...(model ? ["--model", model] : []),
        ];
        const env = Object.fromEntries(
          PASSTHROUGH_ENV.flatMap((key) =>
            process.env[key] === undefined ? [] : [[key, process.env[key]]],
          ),
        );
        const started = Date.now();
        const result = await run(config.CLAUDE_CLI_PATH, args, {
          stdin: request.prompt,
          cwd: scratchDir,
          env,
          timeoutMs,
        });
        log.info(
          {
            ms: Date.now() - started,
            exit: result.code,
            timedOut: result.timedOut,
            tools: tools || null,
          },
          "claude run finished",
        );

        if (result.spawnError?.code === "ENOENT") {
          throw new LlmError(
            "not_installed",
            `Claude Code isn't installed here (looked for "${config.CLAUDE_CLI_PATH}"). Install it from claude.com/code and sign in, or set CLAUDE_CLI_PATH.`,
          );
        }
        if (result.spawnError)
          throw new LlmError("failed", `Couldn't start Claude Code: ${result.spawnError.message}`);
        if (result.timedOut) {
          throw new LlmError(
            "timeout",
            `Claude took longer than ${Math.round(timeoutMs / 1000)} s. Try again, or pick a faster model.`,
          );
        }

        let envelope: z.output<typeof EnvelopeSchema>;
        try {
          envelope = EnvelopeSchema.parse(JSON.parse(result.stdout));
        } catch {
          // Invalid flags and similar errors go to stderr before any JSON is printed.
          throw classifyFailure(
            result.stderr.trim() || result.stdout.trim() || `exit code ${result.code}`,
          );
        }
        if (envelope.is_error || result.code !== 0) {
          throw classifyFailure(
            envelope.result ?? (result.stderr.trim() || `exit code ${result.code}`),
          );
        }
        const parsed = request.schema.safeParse(envelope.structured_output);
        if (!parsed.success) {
          log.warn(
            { issues: parsed.error.issues.slice(0, 5) },
            "claude returned output outside the schema",
          );
          throw new LlmError(
            "invalid_output",
            "Claude's answer didn't match the expected format. Try again.",
          );
        }
        return { data: parsed.data, model: Object.keys(envelope.modelUsage ?? {})[0] ?? null };
      } finally {
        inFlight = false;
      }
    },
  };
}
