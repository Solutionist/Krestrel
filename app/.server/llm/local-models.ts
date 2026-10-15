// Local models on the owner's Ollama (ADR 0020): what is installed (and whether it can read
// images), merged with the suggested sizes, and downloading one through Ollama.

import type { Logger } from "pino";
import * as z from "zod";

import { LOCAL_MODEL_PRESETS, type LocalModelInfo } from "~/lib/ai";

import { ollamaConfig } from "./ollama";

const TagsSchema = z.looseObject({
  models: z.array(z.looseObject({ name: z.string(), size: z.number().optional() })),
});
const ShowSchema = z.looseObject({ capabilities: z.array(z.string()).optional() });

const LIST_TIMEOUT_MS = 5_000;

export interface LocalModels {
  reachable: boolean;
  defaultModel: string;
  models: LocalModelInfo[];
}

/** Installed models (vision flag from Ollama), then the suggested sizes not yet downloaded. */
export async function listLocalModels(context: {
  env: Readonly<Record<string, string | undefined>>;
  logger: Logger;
  fetch?: typeof fetch;
}): Promise<LocalModels> {
  const config = ollamaConfig(context.env);
  const send = context.fetch ?? fetch;
  const presetOf = (id: string) => LOCAL_MODEL_PRESETS.find((preset) => preset.id === id) ?? null;
  const missingPresets = (installed: ReadonlySet<string>): LocalModelInfo[] =>
    LOCAL_MODEL_PRESETS.filter((preset) => !installed.has(preset.id)).map((preset) => ({
      id: preset.id,
      installed: false,
      vision: null,
      size: null,
      preset,
    }));

  let tags: z.output<typeof TagsSchema>;
  try {
    const response = await send(new URL("/api/tags", config.OLLAMA_URL), {
      signal: AbortSignal.timeout(LIST_TIMEOUT_MS),
    });
    tags = TagsSchema.parse(await response.json());
  } catch (err) {
    context.logger.info({ err }, "ollama not reachable for model list");
    return {
      reachable: false,
      defaultModel: config.OLLAMA_MODEL,
      models: missingPresets(new Set()),
    };
  }

  const installed = await Promise.all(
    tags.models.map(async (model): Promise<LocalModelInfo> => {
      let vision: boolean | null = null;
      try {
        const response = await send(new URL("/api/show", config.OLLAMA_URL), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ model: model.name }),
          signal: AbortSignal.timeout(LIST_TIMEOUT_MS),
        });
        vision = ShowSchema.parse(await response.json()).capabilities?.includes("vision") ?? false;
      } catch {
        // Unknown: the picker still offers it; a screenshot read reports if it can't.
      }
      return {
        id: model.name,
        installed: true,
        vision,
        size: model.size ?? null,
        preset: presetOf(model.name),
      };
    }),
  );
  // Suggested sizes first (largest first), then everything else by name.
  const rank = (info: LocalModelInfo) =>
    info.preset ? LOCAL_MODEL_PRESETS.indexOf(info.preset) : LOCAL_MODEL_PRESETS.length;
  installed.sort((a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id));
  return {
    reachable: true,
    defaultModel: config.OLLAMA_MODEL,
    models: [...installed, ...missingPresets(new Set(installed.map((info) => info.id)))],
  };
}

/**
 * Starts downloading `model` through Ollama and returns its progress stream: newline-delimited
 * JSON objects such as `{"status":"pulling …","completed":123,"total":456}`, ending with
 * `{"status":"success"}` or `{"error":"…"}`. Throws when Ollama can't be reached.
 */
export async function pullLocalModel(
  model: string,
  context: { env: Readonly<Record<string, string | undefined>>; signal?: AbortSignal },
): Promise<ReadableStream<Uint8Array>> {
  const config = ollamaConfig(context.env);
  const response = await fetch(new URL("/api/pull", config.OLLAMA_URL), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model, stream: true }),
    signal: context.signal,
  });
  if (!response.ok || !response.body) {
    throw new Error(`Ollama refused the download (HTTP ${response.status}).`);
  }
  return response.body;
}
