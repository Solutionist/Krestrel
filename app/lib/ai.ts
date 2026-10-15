// Which AI answers each feature (ADR 0020): Claude through the owner's Claude Code CLI, or a
// local model on the owner's Ollama. One global default plus optional per-feature overrides,
// chosen in the browser and sent with each request. Shared by server and pages.

import * as z from "zod";

/**
 * Claude Code model aliases; `default` leaves the choice to CLAUDE_MODEL / the CLI. Aliases
 * resolve to the latest model of that tier.
 */
export const CLAUDE_MODELS = ["default", "haiku", "sonnet", "opus", "fable"] as const;
export type ClaudeModel = (typeof CLAUDE_MODELS)[number];

export const CLAUDE_MODEL_LABELS: Record<ClaudeModel, { name: string; hint: string }> = {
  default: { name: "Default", hint: "Your Claude Code default" },
  haiku: { name: "Haiku", hint: "Fastest, lightest" },
  sonnet: { name: "Sonnet", hint: "Fast and capable" },
  opus: { name: "Opus", hint: "Deeper reasoning, slower" },
  fable: { name: "Fable", hint: "Most capable, slowest" },
};

/**
 * Ollama model names as `ollama list` shows them: `name:tag`, `namespace/name:tag`, or a model
 * from another registry, `host/namespace/name:tag` (e.g. `hf.co/user/repo:Q4_K_M`).
 */
export const LocalModelIdSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9._-]*(\/[a-z0-9][a-z0-9._-]*){0,3}(:[a-z0-9][a-z0-9._-]*)?$/i, {
    error: "Not an Ollama model name",
  })
  .max(200);

/**
 * Suggested local models by size, all vision-capable so they also read screenshots. The
 * "instruct" builds answer directly; plain qwen3-vl tags "think" first and run ~5× slower.
 */
export const LOCAL_MODEL_PRESETS = [
  { id: "qwen3.8:27b", tier: "Large", needs: "24 GB GPU", download: "17 GB" },
  {
    id: "qwen3-vl:8b-instruct",
    tier: "Medium",
    needs: "8 GB GPU or 16 GB Mac",
    download: "6.1 GB",
  },
  {
    id: "qwen3-vl:4b-instruct",
    tier: "Small",
    needs: "4 GB GPU or 8 GB laptop",
    download: "3.3 GB",
  },
] as const;

/**
 * A Claude model, or a local Ollama model. Local `null` = the server's OLLAMA_MODEL, so a fresh
 * browser works before the owner picks anything.
 */
export const AiChoiceSchema = z.discriminatedUnion("provider", [
  z.object({ provider: z.literal("claude"), model: z.enum(CLAUDE_MODELS) }),
  z.object({ provider: z.literal("local"), model: LocalModelIdSchema.nullable() }),
]);
export type AiChoice = z.infer<typeof AiChoiceSchema>;

export const AI_FEATURES = ["outlook", "ideas", "import", "grouping"] as const;
export type AiFeature = (typeof AI_FEATURES)[number];

export const AI_FEATURE_LABELS: Record<AiFeature, { name: string; hint: string; vision: boolean }> =
  {
    outlook: { name: "AI outlook", hint: "News, analysts and a plan for one stock", vision: false },
    ideas: { name: "Stock ideas", hint: "Growth, dividend and risky picks", vision: false },
    import: { name: "Screenshot import", hint: "Reads your broker's holdings", vision: true },
    grouping: { name: "Holding groups", hint: "Sector and type per stock", vision: false },
  };

/** Out of the box: Claude, except features that send personal data stay on this computer. */
export const DEFAULT_AI_CHOICE: AiChoice = { provider: "claude", model: "default" };
export const DEFAULT_AI_OVERRIDES: Partial<Record<AiFeature, AiChoice>> = {
  import: { provider: "local", model: null },
  grouping: { provider: "local", model: null },
};

/** How an AI run got current facts, shown with its results. */
export const RESEARCH_MODES = ["web", "tavily", "none"] as const;
export type ResearchMode = (typeof RESEARCH_MODES)[number];

export const RESEARCH_LABELS: Record<ResearchMode, string> = {
  web: "Researched with web search",
  tavily: "Researched with Tavily web search",
  none: "No web search: news feed headlines and the model's own knowledge only",
};

export interface LocalModelInfo {
  id: string;
  installed: boolean;
  /** Can read images (needed for screenshot import); unknown until installed. */
  vision: boolean | null;
  /** Bytes on disk when installed. */
  size: number | null;
  preset: (typeof LOCAL_MODEL_PRESETS)[number] | null;
}

/** GET /api/ai: what the owner can choose from right now. */
export type AiStatus =
  | {
      ok: true;
      claude: { enabled: boolean };
      local: { reachable: boolean; defaultModel: string; models: LocalModelInfo[] };
      tavily: { configured: boolean };
    }
  | { ok: false; error: { code: string; message: string } };

/** Short name for a choice, e.g. "Claude Sonnet" or "Qwen3-VL 4B (local)". */
export function choiceName(choice: AiChoice, defaultLocalModel: string | null): string {
  if (choice.provider === "claude") {
    return choice.model === "default"
      ? "Claude"
      : `Claude ${CLAUDE_MODEL_LABELS[choice.model].name}`;
  }
  const id = choice.model ?? defaultLocalModel ?? "default local model";
  const preset = LOCAL_MODEL_PRESETS.find((candidate) => candidate.id === id);
  return preset ? `${id} (local · ${preset.tier})` : `${id} (local)`;
}
