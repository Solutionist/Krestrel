// AI backends (ADR 0012, 0020): every feature asks for the owner's choice, a Claude model or a
// local Ollama model. LLM_PROVIDER=none turns all AI features off.
import * as z from "zod";

import type { AiChoice } from "~/lib/ai";

import { ConfigError, parseConfig } from "../env-schema";
import { logger } from "../logger";
import { createClaudeCliClient } from "./claude-cli";
import { createOllamaClient } from "./ollama";
import { LLM_ERROR_STATUS, type LlmClient, LlmError } from "./types";
import { createWebSearch, type WebSearch } from "./web-search";

const LlmConfigSchema = z.object({
  /** `none` turns every AI feature off; otherwise the owner picks Claude or a local model. */
  LLM_PROVIDER: z.enum(["claude-cli", "none"]).default("claude-cli"),
});

const disabled: LlmClient = {
  id: "none",
  displayName: "AI (disabled)",
  capabilities: { webSearch: false },
  generateStructured() {
    return Promise.reject(
      new LlmError("disabled", "AI features are turned off (LLM_PROVIDER=none)."),
    );
  },
};

// Module scope, not globalThis: there is no connection to preserve, and a client cached across
// HMR would keep running stale code and throw a stale LlmError class `instanceof` can't see.
let claude: ((model?: string) => LlmClient) | undefined;

export function aiEnabled(): boolean {
  return parseConfig(LlmConfigSchema, process.env, "AI").LLM_PROVIDER !== "none";
}

/** The client for the owner's choice. Claude clients share one busy guard. */
export function getAi(choice: AiChoice): LlmClient {
  if (!aiEnabled()) return disabled;
  if (choice.provider === "local")
    return createOllamaClient({ env: process.env, logger }, choice.model);
  claude ??= createClaudeCliClient({ env: process.env, logger });
  return claude(choice.model === "default" ? undefined : choice.model);
}

/** The owner's Tavily search for local models, or null without TAVILY_API_KEY. */
export function getWebSearch(): WebSearch | null {
  return createWebSearch({ env: process.env, logger });
}

/**
 * The `{ ok: false, error }` response for an expected AI failure (LlmError, or bad AI settings in
 * .env); null for anything else, which the caller handles as unexpected.
 */
export function aiFailureResponse(err: unknown): Response | null {
  const failure =
    err instanceof LlmError
      ? { status: LLM_ERROR_STATUS[err.code], code: err.code }
      : err instanceof ConfigError
        ? { status: 503, code: "config" }
        : null;
  if (!failure || !(err instanceof Error)) return null;
  return Response.json(
    { ok: false, error: { code: failure.code, message: err.message } },
    { status: failure.status },
  );
}
