import { chmodSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { pino } from "pino";
import { afterAll, describe, expect, it, vi } from "vitest";
import * as z from "zod";

import { createClaudeCliClient, type RunProcess, type SpawnResult } from "./claude-cli";
import { LlmError } from "./types";

const logger = pino({ level: "silent" });
const tempRoot = mkdtempSync(join(tmpdir(), "krestrel-claude-test-"));
afterAll(() => rmSync(tempRoot, { recursive: true, force: true }));
const Schema = z.object({ answer: z.number() });
const request = { system: "sys", prompt: "data", schema: Schema };

function result(partial: Partial<SpawnResult>): SpawnResult {
  return { code: 0, stdout: "", stderr: "", timedOut: false, spawnError: null, ...partial };
}

function client(run: RunProcess, env: Record<string, string> = {}) {
  return createClaudeCliClient(
    { env, logger },
    { run, scratchDir: mkdtempSync(join(tempRoot, "kc-")) },
  );
}

async function errorOf(promise: Promise<unknown>): Promise<LlmError> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  if (!(error instanceof LlmError)) throw new Error(`expected LlmError, got ${String(error)}`);
  return error;
}

describe("Claude CLI client", () => {
  it("returns schema-validated structured output and the model name", async () => {
    const run = vi.fn<RunProcess>(async () =>
      result({
        stdout: JSON.stringify({
          is_error: false,
          structured_output: { answer: 42 },
          modelUsage: { "claude-sonnet": {} },
        }),
      }),
    );
    await expect(client(run).generateStructured(request)).resolves.toEqual({
      data: { answer: 42 },
      model: "claude-sonnet",
    });
  });

  it("runs headless with no tools/MCP/session and sends the prompt on stdin, not argv", async () => {
    const run = vi.fn<RunProcess>(async () =>
      result({ stdout: JSON.stringify({ structured_output: { answer: 1 } }) }),
    );
    await client(run, { CLAUDE_MODEL: "opus" }).generateStructured(request);
    const [command, args, options] = run.mock.calls[0] ?? [];
    expect(command).toBe("claude");
    expect(args).toEqual(
      expect.arrayContaining([
        "-p",
        "--tools",
        "",
        "--strict-mcp-config",
        "--no-session-persistence",
        "--model",
        "opus",
      ]),
    );
    expect(args).not.toContain("data");
    expect(options?.stdin).toBe("data");
    // JSON Schema of the request's Zod schema is passed to --json-schema.
    const schemaArg = args?.[(args?.indexOf("--json-schema") ?? -2) + 1] ?? "{}";
    expect(JSON.parse(schemaArg)).toMatchObject({ type: "object", required: ["answer"] });
    // The CLI rejects a draft 2020-12 `$schema` meta-schema reference (seen against the real CLI).
    expect(JSON.parse(schemaArg)).not.toHaveProperty("$schema");
    expect(args).not.toContain("--allowedTools");
    expect(options?.timeoutMs).toBe(180_000);
  });

  it("uses the model picked for the request over CLAUDE_MODEL", async () => {
    const run = vi.fn<RunProcess>(async () =>
      result({ stdout: JSON.stringify({ structured_output: { answer: 1 } }) }),
    );
    await client(run, { CLAUDE_MODEL: "opus" }).generateStructured({ ...request, model: "haiku" });
    const args = run.mock.calls[0]?.[1] ?? [];
    expect(args[args.indexOf("--model") + 1]).toBe("haiku");
    expect(args).not.toContain("opus");
  });

  it("enables and pre-approves exactly the requested tools, keeping MCP off, with the request's timeout", async () => {
    const run = vi.fn<RunProcess>(async () =>
      result({ stdout: JSON.stringify({ structured_output: { answer: 1 } }) }),
    );
    await client(run, { CLAUDE_TIMEOUT_MS: "60000" }).generateStructured({
      ...request,
      tools: ["WebSearch", "WebFetch"],
      timeoutMs: 300_000,
    });
    const [, args = [], options] = run.mock.calls[0] ?? [];
    expect(args[args.indexOf("--tools") + 1]).toBe("WebSearch,WebFetch");
    expect(args[args.indexOf("--allowedTools") + 1]).toBe("WebSearch,WebFetch");
    expect(args).toContain("--strict-mcp-config");
    expect(args).not.toContain("--dangerously-skip-permissions");
    expect(options?.timeoutMs).toBe(300_000);
  });

  it("explains how to sign in when the subscription session has expired (CLI exits 0 with is_error)", async () => {
    const run = async () =>
      result({
        stdout: JSON.stringify({
          is_error: true,
          result: "Failed to authenticate: OAuth session expired and could not be refreshed",
        }),
      });
    const error = await errorOf(client(run).generateStructured(request));
    expect(error.code).toBe("not_signed_in");
    expect(error.message).toMatch(/run `claude`, use \/login/);
  });

  it("maps a missing executable, a timeout, usage limits and off-schema output to plain errors", async () => {
    const enoent = Object.assign(new Error("spawn claude ENOENT"), { code: "ENOENT" });
    expect(
      (
        await errorOf(
          client(async () => result({ code: null, spawnError: enoent })).generateStructured(
            request,
          ),
        )
      ).code,
    ).toBe("not_installed");
    expect(
      (
        await errorOf(
          client(async () => result({ code: null, timedOut: true })).generateStructured(request),
        )
      ).code,
    ).toBe("timeout");
    const limited = async () =>
      result({ stdout: JSON.stringify({ is_error: true, result: "Usage limit reached" }) });
    expect((await errorOf(client(limited).generateStructured(request))).code).toBe("rate_limited");
    const offSchema = async () =>
      result({ stdout: JSON.stringify({ structured_output: { answer: "x" } }) });
    expect((await errorOf(client(offSchema).generateStructured(request))).code).toBe(
      "invalid_output",
    );
  });

  it("allows one run at a time, so double clicks don't spend the subscription twice", async () => {
    let finish: (value: SpawnResult) => void = () => {};
    const run = () =>
      new Promise<SpawnResult>((resolve) => {
        finish = resolve;
      });
    const llm = client(run);
    const first = llm.generateStructured(request);
    expect((await errorOf(llm.generateStructured(request))).code).toBe("busy");
    finish(result({ stdout: JSON.stringify({ structured_output: { answer: 1 } }) }));
    await expect(first).resolves.toMatchObject({ data: { answer: 1 } });
    // Free again afterwards.
    const again = llm.generateStructured(request);
    finish(result({ stdout: JSON.stringify({ structured_output: { answer: 2 } }) }));
    await expect(again).resolves.toMatchObject({ data: { answer: 2 } });
  });
});

describe("Claude CLI client with a real child process", () => {
  it("spawns the CLI in an empty scratch dir with a minimal environment (no app secrets)", async () => {
    const fake = fileURLToPath(new URL("../../../tests/fixtures/fake-claude.mjs", import.meta.url));
    chmodSync(fake, 0o755);
    const scratchDir = realpathSync(mkdtempSync(join(tempRoot, "kc-real-")));
    process.env.ALPACA_SECRET_KEY = "must-not-leak";
    process.env.ANTHROPIC_API_KEY = "would-switch-billing";
    try {
      const llm = createClaudeCliClient({ env: { CLAUDE_CLI_PATH: fake }, logger }, { scratchDir });
      const EchoSchema = z.object({
        args: z.array(z.string()),
        stdin: z.string(),
        cwd: z.string(),
        envKeys: z.array(z.string()),
      });
      const { data, model } = await llm.generateStructured({
        system: "s",
        prompt: "candles…",
        schema: EchoSchema,
      });
      expect(model).toBe("claude-test-model");
      expect(data.stdin).toBe("candles…");
      expect(realpathSync(data.cwd)).toBe(scratchDir);
      expect(data.envKeys).not.toContain("ALPACA_SECRET_KEY");
      expect(data.envKeys).not.toContain("ANTHROPIC_API_KEY");
      expect(data.envKeys).not.toContain("DATABASE_URL");
      expect(data.envKeys).toContain("HOME");
    } finally {
      delete process.env.ALPACA_SECRET_KEY;
      delete process.env.ANTHROPIC_API_KEY;
    }
  });
});
