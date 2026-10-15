import { CheckCircleIcon, SparkleIcon, WarningCircleIcon } from "@phosphor-icons/react";

import { aiDefault, useAiStatus } from "~/hooks/use-ai";
import { AI_FEATURE_LABELS, AI_FEATURES, type AiFeature, type AiStatus } from "~/lib/ai";

import { HEADING, LABEL, POPOVER } from "../ui/styles";
import { AiModelPicker, FeatureModelPicker } from "./ai-model-picker";

const POPOVER_ID = "ai-settings";

/**
 * Top-bar "AI" menu (ADR 0020): the default model for every AI feature, an optional model per
 * feature, local model downloads, and whether Claude, Ollama and Tavily are ready.
 */
export function AiSettings() {
  const { status, refresh } = useAiStatus();
  const [fallback, setFallback] = aiDefault.use();

  return (
    <>
      <button
        type="button"
        popoverTarget={POPOVER_ID}
        className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-subtle px-3 text-xs font-medium text-muted transition-colors duration-150 hover:text-text"
        title="Choose Claude or a local model for each AI feature"
      >
        <SparkleIcon aria-hidden size={14} weight="fill" className="text-accent" />
        AI
      </button>
      <div
        id={POPOVER_ID}
        popover="auto"
        role="dialog"
        aria-label="AI models"
        // Ollama may have been started, or a model pulled in a terminal, since the page loaded.
        onToggle={(event) => {
          if (event.newState === "open") refresh();
        }}
        className={`${POPOVER} fixed inset-auto top-14 right-4 m-0 max-h-[85vh] w-[26rem] overflow-y-auto p-4 text-sm text-text`}
      >
        <div className="grid gap-4">
          <div className="grid gap-1">
            <h2 className={HEADING}>AI models</h2>
            <p className="text-xs text-muted">
              Claude uses your Claude Code subscription. Local models run on this computer through
              Ollama, so nothing leaves it.
            </p>
          </div>

          <div className="grid gap-1.5">
            <span className={LABEL}>Default for every feature</span>
            <AiModelPicker
              label="Default AI model"
              value={fallback}
              onChange={(choice) => choice && setFallback(choice)}
              status={status}
              onDownloaded={refresh}
            />
          </div>

          <div className="grid gap-3 border-t border-rule/60 pt-3">
            {AI_FEATURES.map((feature) => (
              <FeatureRow key={feature} feature={feature} />
            ))}
          </div>

          <ReadinessList status={status} />
        </div>
      </div>
    </>
  );
}

function FeatureRow({ feature }: { feature: AiFeature }) {
  const { name, hint } = AI_FEATURE_LABELS[feature];
  return (
    <div className="grid gap-1.5">
      <span className="flex items-baseline justify-between gap-2">
        <span className={LABEL}>{name}</span>
        <span className="text-xs text-muted/80">{hint}</span>
      </span>
      <FeatureModelPicker feature={feature} label={`${name} model`} />
    </div>
  );
}

function ReadinessList({ status }: { status: AiStatus | undefined }) {
  if (!status) return <p className="text-xs text-muted">Checking what's available…</p>;
  if (!status.ok) return <p className="text-xs text-fall">{status.error.message}</p>;
  const installed = status.local.models.filter((model) => model.installed).length;
  const items: Array<{ ok: boolean; text: string }> = [
    {
      ok: status.claude.enabled,
      text: status.claude.enabled
        ? "Claude: through your Claude Code CLI (sign in with `claude` once)"
        : "AI is turned off (LLM_PROVIDER=none)",
    },
    {
      ok: status.local.reachable,
      text: status.local.reachable
        ? `Ollama: running, ${installed} model${installed === 1 ? "" : "s"} downloaded`
        : "Ollama: not running (install from ollama.com to use local models)",
    },
    {
      ok: status.tavily.configured,
      text: status.tavily.configured
        ? "Tavily: set, so local models get web search for outlooks and ideas"
        : "Tavily: not set. Add TAVILY_API_KEY to .env (tavily.com) so local models can search the web",
    },
  ];
  return (
    <ul className="grid gap-1.5 border-t border-rule/60 pt-3 text-xs">
      {items.map((item) => (
        <li key={item.text} className="flex items-start gap-1.5">
          {item.ok ? (
            <CheckCircleIcon aria-hidden size={14} className="mt-px shrink-0 text-accent" />
          ) : (
            <WarningCircleIcon aria-hidden size={14} className="mt-px shrink-0 text-muted" />
          )}
          <span className={item.ok ? "text-text" : "text-muted"}>{item.text}</span>
        </li>
      ))}
    </ul>
  );
}
