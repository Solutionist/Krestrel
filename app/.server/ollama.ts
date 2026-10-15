// The owner's local Ollama (ADR 0018, 0019): screenshot import and holding classification ask it
// for answers in a JSON schema, which Ollama enforces as a grammar and this module re-validates.
// Ollama must be on this machine (loopback URL only), so nothing sent to it leaves it.

import type { Logger } from "pino";
import * as z from "zod";

import { parseConfig } from "./env-schema";

const LOOPBACK_HOSTS: Record<string, true> = { "127.0.0.1": true, localhost: true, "[::1]": true };

const OllamaConfigSchema = z.object({
  OLLAMA_URL: z
    .url({ protocol: /^https?$/ })
    .refine((url) => LOOPBACK_HOSTS[new URL(url).hostname] === true, {
      error: "must point at this machine (127.0.0.1, localhost or [::1])",
    })
    .default("http://127.0.0.1:11434"),
  // A vision model, since screenshot import needs one; it also answers text-only questions.
  // The instruct build answers directly; plain qwen3-vl:8b "thinks" first (~5× slower) and
  // ignores `think: false`.
  OLLAMA_VISION_MODEL: z.string().min(1).default("qwen3-vl:8b-instruct"),
});

const ChatResponseSchema = z.looseObject({
  message: z.object({ content: z.string() }),
  done_reason: z.string().optional(),
});
const ErrorBodySchema = z.looseObject({ error: z.string() });

export type OllamaErrorCode =
  | "unavailable"
  | "model_missing"
  | "timeout"
  | "invalid_output"
  | "failed";

/** Expected failure with a plain-language message safe to show in the UI. */
export class OllamaError extends Error {
  override name = "OllamaError";
  constructor(
    readonly code: OllamaErrorCode,
    message: string,
  ) {
    super(message);
  }
}

/** HTTP status for each failure, for the routes that call Ollama. */
export const OLLAMA_ERROR_STATUS: Record<OllamaErrorCode, number> = {
  unavailable: 503,
  model_missing: 503,
  timeout: 504,
  invalid_output: 502,
  failed: 502,
};

export interface OllamaContext {
  env: Readonly<Record<string, string | undefined>>;
  logger: Logger;
  fetch?: typeof fetch;
}

export interface OllamaRequest<T extends z.ZodType> {
  /** What the owner was doing, for error messages ("Screenshot import"). */
  feature: string;
  system: string;
  prompt: string;
  images?: readonly Uint8Array[];
  /** Shape of the answer; also sent to Ollama as the output grammar. */
  schema: T;
  timeoutMs: number;
}

/** Asks the local model and returns its schema-valid answer. Throws OllamaError or ConfigError. */
export async function ollamaStructured<T extends z.ZodType>(
  request: OllamaRequest<T>,
  context: OllamaContext,
): Promise<z.output<T>> {
  const config = parseConfig(OllamaConfigSchema, context.env, "Ollama");
  const model = config.OLLAMA_VISION_MODEL;
  const log = context.logger.child({ mod: "ollama", model, feature: request.feature });
  const send = context.fetch ?? fetch;
  const { $schema: _metaSchema, ...format } = z.toJSONSchema(request.schema, { target: "draft-7" });

  const started = Date.now();
  let response: Response;
  try {
    response = await send(new URL("/api/chat", config.OLLAMA_URL), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: request.system },
          {
            role: "user",
            content: request.prompt,
            ...(request.images?.length
              ? { images: request.images.map((image) => Buffer.from(image).toString("base64")) }
              : {}),
          },
        ],
        format,
        stream: false,
        think: false,
        // Ollama's default 4096-token window can't hold a phone screenshot (~3,000 image tokens)
        // plus the answer; the reply then stops empty with done_reason "length".
        options: { temperature: 0, num_ctx: 16_384 },
      }),
      signal: AbortSignal.timeout(request.timeoutMs),
    });
  } catch (err) {
    if (err instanceof Error && err.name === "TimeoutError") {
      throw new OllamaError(
        "timeout",
        `Your local model took longer than ${Math.round(request.timeoutMs / 60_000)} minutes. Try again, or use a GPU machine.`,
      );
    }
    log.warn({ err }, "ollama unreachable");
    throw new OllamaError(
      "unavailable",
      `${request.feature} needs Ollama running. Install Ollama from ollama.com, run \`ollama pull ${model}\`, and keep Ollama running.`,
    );
  }

  if (!response.ok) {
    const body = ErrorBodySchema.safeParse(await response.json().catch(() => null));
    const message = body.success ? body.data.error : `HTTP ${response.status}`;
    log.warn({ status: response.status, message }, "ollama request failed");
    if (response.status === 404 || /not found/i.test(message)) {
      throw new OllamaError(
        "model_missing",
        `The model ${model} isn't downloaded yet. Run \`ollama pull ${model}\`, then try again.`,
      );
    }
    throw new OllamaError("failed", `Ollama couldn't answer: ${message.slice(0, 200)}`);
  }

  const envelope = ChatResponseSchema.safeParse(await response.json().catch(() => null));
  if (envelope.success) {
    try {
      const parsed = request.schema.safeParse(JSON.parse(envelope.data.message.content));
      if (parsed.success) {
        log.info({ ms: Date.now() - started }, "ollama answered");
        return parsed.data;
      }
    } catch {
      // Not JSON: reported below.
    }
  }
  log.warn(
    { doneReason: envelope.success ? envelope.data.done_reason : null },
    "model answered outside the schema",
  );
  throw new OllamaError("invalid_output", "Your local model's answer was unreadable. Try again.");
}
