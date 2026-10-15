// The owner's AI choices (ADR 0020): one global default plus optional per-feature overrides,
// remembered in this browser; what the server can offer (GET /api/ai); and local model
// downloads, shared by every picker so progress survives closing a menu.

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { useFetcher } from "react-router";
import * as z from "zod";

import {
  AI_FEATURES,
  type AiChoice,
  AiChoiceSchema,
  type AiFeature,
  type AiStatus,
  choiceName,
  DEFAULT_AI_CHOICE,
  DEFAULT_AI_OVERRIDES,
} from "~/lib/ai";

import { createStoredValue } from "./stored-value";

const OverridesSchema = z.partialRecord(z.enum(AI_FEATURES), AiChoiceSchema);

function parseJson<T>(schema: z.ZodType<T>, raw: string): T | null {
  try {
    const parsed = schema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** The model every AI feature uses unless it has its own. */
export const aiDefault = createStoredValue<AiChoice>(
  "krestrel.ai.default",
  DEFAULT_AI_CHOICE,
  (raw) => parseJson(AiChoiceSchema, raw),
  (value) => JSON.stringify(value),
);

/** Per-feature choices; a missing feature follows the default. */
export const aiOverrides = createStoredValue<Partial<Record<AiFeature, AiChoice>>>(
  "krestrel.ai.overrides",
  DEFAULT_AI_OVERRIDES,
  (raw) => parseJson(OverridesSchema, raw),
  (value) => JSON.stringify(value),
);

/** The AI a feature uses, its own override (null = follows the default), and a setter. */
export function useAiChoice(feature: AiFeature): {
  choice: AiChoice;
  override: AiChoice | null;
  setOverride: (choice: AiChoice | null) => void;
} {
  const [fallback] = aiDefault.use();
  const [overrides, setOverrides] = aiOverrides.use();
  const override = overrides[feature] ?? null;
  const setOverride = useCallback(
    (choice: AiChoice | null) => {
      const { [feature]: _previous, ...others } = overrides;
      setOverrides(choice ? { ...others, [feature]: choice } : others);
    },
    [feature, overrides, setOverrides],
  );
  return { choice: override ?? fallback, override, setOverride };
}

/**
 * Set when one caller starts the first status load, until the shared fetcher shows it under way:
 * every caller mounted in the same commit sees "idle, no data" and would each start (and abort)
 * another load, each running the server's Ollama probe.
 */
let statusLoadStarted = false;

/**
 * What the server can offer: Claude, local models (installed or suggested), Tavily. One shared
 * fetcher for every picker and the AI menu, so a refresh after a download updates them all and
 * remounts reuse the loaded status.
 */
export function useAiStatus(): { status: AiStatus | undefined; refresh: () => void } {
  const { load, state, data } = useFetcher<AiStatus>({ key: "ai-status" });
  const refresh = useCallback(() => {
    void load("/api/ai");
  }, [load]);
  useEffect(() => {
    if (state !== "idle" || data !== undefined) {
      statusLoadStarted = false;
      return;
    }
    if (statusLoadStarted) return;
    statusLoadStarted = true;
    refresh();
  }, [state, data, refresh]);
  return { status: data, refresh };
}

/** The model `feature` runs on now, and its display name with the server's local default resolved. */
export function useFeatureModel(feature: AiFeature): { choice: AiChoice; name: string } {
  const { choice } = useAiChoice(feature);
  const { status } = useAiStatus();
  return { choice, name: choiceName(choice, status?.ok ? status.local.defaultModel : null) };
}

export type DownloadState =
  | { kind: "running"; status: string; fraction: number | null }
  | { kind: "done" }
  | { kind: "error"; message: string };

const ProgressLineSchema = z.looseObject({
  status: z.string().optional(),
  completed: z.number().optional(),
  total: z.number().optional(),
  error: z.string().optional(),
});
const ErrorBodySchema = z.object({ error: z.object({ message: z.string() }) });

// Module-level, so every picker on the page sees the same downloads.
const downloads = new Map<string, DownloadState>();
const listeners = new Set<() => void>();
let snapshot: ReadonlyMap<string, DownloadState> = new Map();

function publish(model: string, state: DownloadState) {
  downloads.set(model, state);
  snapshot = new Map(downloads);
  for (const listener of listeners) listener();
}

/** Downloads a local model through the server (Ollama pull), publishing its progress. */
export async function downloadModel(model: string): Promise<boolean> {
  if (downloads.get(model)?.kind === "running") return false;
  publish(model, { kind: "running", status: "Starting…", fraction: null });
  try {
    const response = await fetch("/api/ai", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ intent: "pull", model }),
    });
    if (!response.ok || !response.body) {
      const body = ErrorBodySchema.safeParse(await response.json().catch(() => null));
      const message = body.success
        ? body.data.error.message
        : `Download failed (HTTP ${response.status}).`;
      publish(model, { kind: "error", message });
      return false;
    }
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffered = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffered += value;
      const lines = buffered.split("\n");
      buffered = lines.pop() ?? "";
      for (const line of lines) {
        const progress = line.trim() ? parseJson(ProgressLineSchema, line) : null;
        if (!progress) continue;
        if (progress.error) {
          publish(model, { kind: "error", message: progress.error });
          return false;
        }
        if (progress.status === "success") {
          publish(model, { kind: "done" });
          return true;
        }
        publish(model, {
          kind: "running",
          status: progress.status ?? "Downloading…",
          fraction:
            progress.total && progress.completed !== undefined
              ? progress.completed / progress.total
              : null,
        });
      }
    }
    publish(model, { kind: "error", message: "The download stopped before it finished." });
    return false;
  } catch {
    publish(model, {
      kind: "error",
      message: "Couldn't reach Krestrel's server for the download.",
    });
    return false;
  }
}

function subscribeDownloads(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function readDownloads(): ReadonlyMap<string, DownloadState> {
  return snapshot;
}

/** Live state of every local model download started in this tab. */
export function useDownloads(): ReadonlyMap<string, DownloadState> {
  return useSyncExternalStore(subscribeDownloads, readDownloads, readDownloads);
}
