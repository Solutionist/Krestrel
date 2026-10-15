import { DownloadSimpleIcon, WarningCircleIcon } from "@phosphor-icons/react";

import { aiDefault, downloadModel, useAiChoice, useAiStatus, useDownloads } from "~/hooks/use-ai";
import {
  AI_FEATURE_LABELS,
  type AiChoice,
  type AiFeature,
  type AiStatus,
  CLAUDE_MODEL_LABELS,
  CLAUDE_MODELS,
  choiceName,
  type LocalModelInfo,
} from "~/lib/ai";

import { Button } from "../ui/button";
import { FIELD } from "../ui/styles";

const FOLLOW = "follow";

/** Option value for a choice: `claude:<alias>`, `local:` (server default) or `local:<model>`. */
function encode(choice: AiChoice | null): string {
  if (!choice) return FOLLOW;
  return `${choice.provider}:${choice.model ?? ""}`;
}

function decode(value: string): AiChoice | null {
  if (value === FOLLOW) return null;
  const [provider, ...rest] = value.split(":");
  const model = rest.join(":");
  if (provider === "claude") {
    const alias = CLAUDE_MODELS.find((candidate) => candidate === model);
    return alias ? { provider: "claude", model: alias } : null;
  }
  return { provider: "local", model: model || null };
}

function gigabytes(bytes: number): string {
  return `${(bytes / 1e9).toFixed(1)} GB`;
}

function localLabel(info: LocalModelInfo, needsVision: boolean): string {
  const tier = info.preset ? `${info.preset.tier} · ` : "";
  const detail = info.installed
    ? info.size
      ? ` · ${gigabytes(info.size)}`
      : ""
    : ` · not downloaded (${info.preset?.download ?? "?"}, needs ${info.preset?.needs ?? "?"})`;
  const blind = needsVision && info.vision === false ? " · can't read images" : "";
  return `${tier}${info.id}${detail}${blind}`;
}

/**
 * Picks Claude (a model alias) or a local Ollama model for an AI feature. `followLabel` adds a
 * "use the default" entry (value null). Local models not yet downloaded offer a Download button.
 */
export function AiModelPicker({
  label,
  value,
  onChange,
  status,
  followLabel,
  needsVision = false,
  disabled = false,
  onDownloaded,
}: {
  label: string;
  value: AiChoice | null;
  onChange: (choice: AiChoice | null) => void;
  status: AiStatus | undefined;
  followLabel?: string;
  /** Screenshot import: models that can't read images are offered but disabled. */
  needsVision?: boolean;
  disabled?: boolean;
  onDownloaded?: () => void;
}) {
  const downloads = useDownloads();
  const local = status?.ok ? status.local : null;
  const models = local?.models ?? [];
  const defaultLocal = local?.defaultModel ?? null;
  // A saved choice that isn't in the list (removed from Ollama) stays visible and selected.
  const unknownLocal =
    value?.provider === "local" && value.model && !models.some((info) => info.id === value.model)
      ? value.model
      : null;
  const chosenLocalId = value?.provider === "local" ? (value.model ?? defaultLocal) : null;
  const chosenInfo = models.find((info) => info.id === chosenLocalId) ?? null;
  const download = chosenLocalId ? downloads.get(chosenLocalId) : undefined;

  return (
    <div className="grid gap-1.5">
      <select
        aria-label={label}
        value={encode(value)}
        onChange={(event) => onChange(decode(event.target.value))}
        disabled={disabled}
        className={`${FIELD} h-9 w-full cursor-pointer pr-8 [&_option]:bg-panel [&_option]:text-text`}
      >
        {followLabel !== undefined && <option value={FOLLOW}>{followLabel}</option>}
        <optgroup label="Claude (your subscription)">
          {CLAUDE_MODELS.map((model) => (
            <option key={model} value={`claude:${model}`}>
              Claude {CLAUDE_MODEL_LABELS[model].name} · {CLAUDE_MODEL_LABELS[model].hint}
            </option>
          ))}
        </optgroup>
        <optgroup label="Local (Ollama on this computer)">
          <option value="local:">Local default ({defaultLocal ?? "OLLAMA_MODEL"})</option>
          {models.map((info) => (
            <option
              key={info.id}
              value={`local:${info.id}`}
              disabled={needsVision && info.vision === false}
            >
              {localLabel(info, needsVision)}
            </option>
          ))}
          {unknownLocal && <option value={`local:${unknownLocal}`}>{unknownLocal}</option>}
        </optgroup>
      </select>

      {value?.provider === "local" && local && !local.reachable && (
        <p className="flex items-start gap-1.5 text-xs text-fall">
          <WarningCircleIcon aria-hidden size={14} className="mt-px shrink-0" />
          Ollama isn't running. Install it from ollama.com and start it to use local models.
        </p>
      )}
      {chosenInfo && !chosenInfo.installed && local?.reachable && download?.kind !== "done" && (
        <div className="grid gap-1">
          {download?.kind === "running" ? (
            <div className="grid gap-1" role="status">
              <div className="h-1.5 overflow-hidden rounded-full bg-subtle">
                <div
                  className="h-full rounded-full bg-accent transition-[width] duration-300"
                  style={{ width: `${Math.round((download.fraction ?? 0) * 100)}%` }}
                />
              </div>
              <p className="text-xs text-muted tabular-nums">
                {download.status}
                {download.fraction !== null && ` · ${Math.round(download.fraction * 100)}%`}
              </p>
            </div>
          ) : (
            <Button
              variant="secondary"
              size="sm"
              onClick={async () => {
                if (chosenLocalId && (await downloadModel(chosenLocalId))) onDownloaded?.();
              }}
            >
              <DownloadSimpleIcon aria-hidden size={14} />
              Download {chosenInfo.id} ({chosenInfo.preset?.download ?? "size unknown"})
            </Button>
          )}
          {download?.kind === "error" && (
            <p role="alert" className="text-xs text-fall">
              {download.message}
            </p>
          )}
        </div>
      )}
      {value && (
        <p className="text-xs text-muted">
          {value.provider === "claude"
            ? "Sent to Anthropic through your Claude Code CLI."
            : `Runs on this computer: ${choiceName(value, defaultLocal)}.`}
        </p>
      )}
    </div>
  );
}

/**
 * The model picker for one AI feature: its own override, or "Default (…)" to follow the shared
 * default. Vision-less models are disabled for features that read images.
 */
export function FeatureModelPicker({
  feature,
  label,
  disabled = false,
}: {
  feature: AiFeature;
  label: string;
  disabled?: boolean;
}) {
  const { override, setOverride } = useAiChoice(feature);
  const [fallback] = aiDefault.use();
  const { status, refresh } = useAiStatus();
  const defaultLocal = status?.ok ? status.local.defaultModel : null;
  return (
    <AiModelPicker
      label={label}
      value={override}
      onChange={setOverride}
      status={status}
      followLabel={`Default (${choiceName(fallback, defaultLocal)})`}
      needsVision={AI_FEATURE_LABELS[feature].vision}
      disabled={disabled}
      onDownloaded={refresh}
    />
  );
}
