// A local model on the owner's Ollama (ADR 0018, 0020). Answers come back in a JSON schema that
// Ollama enforces as a grammar and this client re-validates. Ollama must be on this machine
// (loopback URL only), so nothing sent to it leaves it.

import type { Logger } from "pino";
import * as z from "zod";

import { parseConfig } from "../env-schema";
import { type LlmClient, LlmError, type StructuredRequest, type StructuredResult } from "./types";

const LOOPBACK_HOSTS: Record<string, true> = { "127.0.0.1": true, localhost: true, "[::1]": true };

const OllamaConfigSchema = z.object({
  OLLAMA_URL: z
    .url({ protocol: /^https?$/ })
    .refine((url) => URL.canParse(url) && LOOPBACK_HOSTS[new URL(url).hostname] === true, {
      error: "must point at this machine (127.0.0.1, localhost or [::1])",
    })
    .default("http://127.0.0.1:11434"),
  /** Used when the owner picks "local" without naming a model. Vision-capable, for imports. */
  OLLAMA_MODEL: z.string().min(1).default("qwen3-vl:8b-instruct"),
});
export type OllamaConfig = z.output<typeof OllamaConfigSchema>;

export function ollamaConfig(env: Readonly<Record<string, string | undefined>>): OllamaConfig {
  return parseConfig(OllamaConfigSchema, env, "Ollama");
}

/** Model loading can take a minute or two; a CPU-only machine can take minutes per answer. */
const DEFAULT_TIMEOUT_MS = 300_000;

const ChatResponseSchema = z.looseObject({
  message: z.object({ content: z.string() }),
  done_reason: z.string().optional(),
});
const ErrorBodySchema = z.looseObject({ error: z.string() });

export interface OllamaContext {
  env: Readonly<Record<string, string | undefined>>;
  logger: Logger;
  fetch?: typeof fetch;
}

/** A client for one local model (`null`: OLLAMA_MODEL). */
export function createOllamaClient(context: OllamaContext, chosenModel: string | null): LlmClient {
  const config = ollamaConfig(context.env);
  const model = chosenModel ?? config.OLLAMA_MODEL;
  const log = context.logger.child({ mod: "ollama", model });
  const send = context.fetch ?? fetch;

  return {
    id: "ollama",
    displayName: `${model} (local, via Ollama)`,
    capabilities: { webSearch: false },

    async generateStructured<T extends z.ZodType>(
      request: StructuredRequest<T>,
    ): Promise<StructuredResult<z.output<T>>> {
      const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      const { $schema: _metaSchema, ...format } = z.toJSONSchema(request.schema, {
        target: "draft-7",
      });
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
            // Ollama's default 4096-token window can't hold a phone screenshot (~3,000 image
            // tokens) or a research-filled prompt plus the answer; the reply then stops empty.
            options: { temperature: 0, num_ctx: 16_384 },
          }),
          signal: request.signal
            ? AbortSignal.any([AbortSignal.timeout(timeoutMs), request.signal])
            : AbortSignal.timeout(timeoutMs),
        });
      } catch (err) {
        if (err instanceof Error && err.name === "TimeoutError") {
          throw new LlmError(
            "timeout",
            `${model} took longer than ${Math.round(timeoutMs / 60_000)} minutes. Try a smaller model, or a GPU machine.`,
          );
        }
        if (request.signal?.aborted)
          throw new LlmError("failed", "Stopped: the page that asked for this was closed.");
        log.warn({ err }, "ollama unreachable");
        throw new LlmError(
          "unavailable",
          `Ollama isn't running. Install it from ollama.com, start it, and download ${model} (Download in AI settings, or \`ollama pull ${model}\`).`,
        );
      }

      if (!response.ok) {
        const body = ErrorBodySchema.safeParse(await response.json().catch(() => null));
        const message = body.success ? body.data.error : `HTTP ${response.status}`;
        log.warn({ status: response.status, message }, "ollama request failed");
        if (response.status === 404 || /not found/i.test(message)) {
          throw new LlmError(
            "model_missing",
            `The local model ${model} isn't downloaded yet. Use Download in AI settings, or run \`ollama pull ${model}\`.`,
          );
        }
        if (request.images?.length && /image|vision|multimodal/i.test(message)) {
          throw new LlmError(
            "unsupported",
            `${model} can't read images. Pick a vision model (e.g. qwen3-vl) for screenshot import.`,
          );
        }
        throw new LlmError("failed", `Ollama couldn't answer: ${message.slice(0, 200)}`);
      }

      const envelope = ChatResponseSchema.safeParse(await response.json().catch(() => null));
      if (envelope.success) {
        try {
          const parsed = request.schema.safeParse(JSON.parse(envelope.data.message.content));
          if (parsed.success) {
            log.info({ ms: Date.now() - started }, "ollama answered");
            return { data: parsed.data, model };
          }
        } catch {
          // Not JSON: reported below.
        }
      }
      log.warn(
        { doneReason: envelope.success ? envelope.data.done_reason : null },
        "model answered outside the schema",
      );
      throw new LlmError("invalid_output", `${model}'s answer was unreadable. Try again.`);
    },
  };
}
