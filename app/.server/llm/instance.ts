// LLM backend registry (ADR 0012). Adding a backend = a new client module + one line here.
import * as z from "zod";

import { ConfigError, parseConfig } from "../env-schema";
import { logger } from "../logger";
import { createClaudeCliClient } from "./claude-cli";
import { type LlmClient, LlmError } from "./types";

const LlmConfigSchema = z.object({
  /** `claude-cli` (default) or `none` to turn the AI outlook off. */
  LLM_PROVIDER: z.string().default("claude-cli"),
});

const BACKENDS: Record<
  string,
  (context: { env: NodeJS.ProcessEnv; logger: typeof logger }) => LlmClient
> = {
  "claude-cli": createClaudeCliClient,
};

const disabled: LlmClient = {
  id: "none",
  displayName: "AI outlook (disabled)",
  generateStructured() {
    return Promise.reject(
      new LlmError("disabled", "The AI outlook is turned off (LLM_PROVIDER=none)."),
    );
  },
};

// Module scope, not globalThis: unlike the market hub there is no connection to preserve, and a
// client cached across HMR would keep running stale code and throw errors of a stale LlmError
// class that `instanceof` no longer recognises.
let cached: LlmClient | undefined;

/** The configured LLM backend. */
export function getLlm(): LlmClient {
  if (cached) return cached;
  const { LLM_PROVIDER } = parseConfig(LlmConfigSchema, process.env, "AI outlook");
  let client: LlmClient;
  if (LLM_PROVIDER === "none") client = disabled;
  else {
    const create = BACKENDS[LLM_PROVIDER];
    if (!create) {
      throw new ConfigError(
        `Unknown LLM_PROVIDER "${LLM_PROVIDER}". Available: ${[...Object.keys(BACKENDS), "none"].join(", ")}.`,
      );
    }
    client = create({ env: process.env, logger });
  }
  cached = client;
  return client;
}
