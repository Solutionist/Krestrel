// Contract between Krestrel and any LLM backend (ADR 0012, 0020). Backends live in this folder:
// Claude through the owner's Claude Code CLI, or a local model on the owner's Ollama. Callers
// only see structured, Zod-validated results and LlmError.
import type * as z from "zod";

export interface StructuredRequest<T extends z.ZodType> {
  /** Replaces the backend's default system prompt. */
  system: string;
  prompt: string;
  /** Output contract: sent to the model as JSON Schema and enforced on the response. */
  schema: T;
  /** Images to read (PNG/JPEG/WebP bytes); needs a vision-capable model. */
  images?: readonly Uint8Array[];
  /**
   * Let the model search and read the web itself. Only backends with `webSearch` can; callers
   * check `capabilities` and otherwise supply research in the prompt.
   */
  webSearch?: boolean;
  /** Overrides the backend's default timeout for this call. */
  timeoutMs?: number;
}

export interface StructuredResult<T> {
  data: T;
  /** Model reported by the backend, when known. */
  model: string | null;
}

export interface LlmClient {
  readonly id: "claude-cli" | "ollama" | "none";
  /** Human-readable name for UI copy, e.g. "Claude (your subscription via Claude Code)". */
  readonly displayName: string;
  readonly capabilities: {
    /** Searches the web on its own (Claude's WebSearch/WebFetch). */
    webSearch: boolean;
  };
  generateStructured<T extends z.ZodType>(
    request: StructuredRequest<T>,
  ): Promise<StructuredResult<z.output<T>>>;
}

export type LlmErrorCode =
  | "disabled"
  | "not_installed"
  | "not_signed_in"
  /** Ollama isn't running (or not reachable on its loopback URL). */
  | "unavailable"
  /** The chosen local model isn't downloaded. */
  | "model_missing"
  /** The chosen model can't do what was asked (e.g. read images). */
  | "unsupported"
  | "busy"
  | "timeout"
  | "rate_limited"
  | "invalid_output"
  | "failed";

/** HTTP status for each failure, shared by every route that calls an LLM. */
export const LLM_ERROR_STATUS: Record<LlmErrorCode, number> = {
  disabled: 503,
  not_installed: 503,
  not_signed_in: 503,
  unavailable: 503,
  model_missing: 503,
  unsupported: 422,
  busy: 429,
  rate_limited: 429,
  timeout: 504,
  invalid_output: 502,
  failed: 502,
};

/** Expected failure with a plain-language message safe to show in the UI (no secrets). */
export class LlmError extends Error {
  override name = "LlmError";
  constructor(
    readonly code: LlmErrorCode,
    message: string,
  ) {
    super(message);
  }
}
