// Contract between Krestrel and any LLM backend (ADR 0012). Backends live in this folder and are
// chosen by LLM_PROVIDER; callers only see structured, Zod-validated results.
import type * as z from "zod";

export interface StructuredRequest<T extends z.ZodType> {
  /** Replaces the backend's default system prompt. */
  system: string;
  prompt: string;
  /** Output contract: sent to the model as JSON Schema and enforced on the response. */
  schema: T;
  /** Model alias or full name for this call; the backend's configured default when omitted. */
  model?: string;
}

export interface StructuredResult<T> {
  data: T;
  /** Model reported by the backend, when known. */
  model: string | null;
}

export interface LlmClient {
  readonly id: string;
  /** Human-readable name for UI copy, e.g. "Claude (your subscription via Claude Code)". */
  readonly displayName: string;
  generateStructured<T extends z.ZodType>(
    request: StructuredRequest<T>,
  ): Promise<StructuredResult<z.output<T>>>;
}

export type LlmErrorCode =
  | "disabled"
  | "not_installed"
  | "not_signed_in"
  | "busy"
  | "timeout"
  | "rate_limited"
  | "invalid_output"
  | "failed";

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
