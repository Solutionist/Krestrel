import { CheckIcon, LightbulbIcon } from "@phosphor-icons/react";
import { useFeatureModel } from "~/hooks/use-ai";
import { type Focus, SECTOR_SHORT, SECTORS } from "~/lib/ideas";

import { FeatureModelPicker } from "../ai/ai-model-picker";
import { Button } from "../ui/button";
import { CARD, HEADING, LABEL } from "../ui/styles";
import { SECTOR_COLORS } from "./sector-mix";

const OPTION =
  "flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors duration-150 has-checked:bg-accent/10 has-checked:text-text has-focus-visible:outline-2 has-focus-visible:outline-accent/75 not-has-checked:text-muted not-has-checked:hover:bg-subtle not-has-checked:hover:text-text";

/** Sidebar: what to look for (diversify or one sector), which AI model, and the button. */
export function IdeasSidebar({
  focus,
  onFocus,
  loading,
  hasResult,
  onFind,
}: {
  focus: Focus;
  onFocus: (focus: Focus) => void;
  loading: boolean;
  /** A result is shown for this focus, so the button refreshes it. */
  hasResult: boolean;
  onFind: () => void;
}) {
  const { choice, name: modelName } = useFeatureModel("ideas");

  return (
    <aside aria-label="Find ideas" className={`${CARD} flex min-h-0 flex-col`}>
      <h2 className={`${HEADING} flex items-center gap-1.5 px-4 pt-4 pb-2`}>
        <LightbulbIcon aria-hidden size={16} className="text-accent" />
        Find ideas
      </h2>
      <fieldset className="min-h-0 flex-1 overflow-y-auto px-2 pb-2" disabled={loading}>
        <legend className="sr-only">Focus</legend>
        <label className={`${OPTION} mb-1`}>
          <input
            type="radio"
            name="focus"
            value="diversify"
            checked={focus === "diversify"}
            onChange={() => onFocus("diversify")}
            className="sr-only"
          />
          <span className="grid min-w-0 flex-1 gap-0.5">
            <span className="font-medium text-text">Diversify my portfolio</span>
            <span className="text-xs text-muted">Fill the sectors you're light on</span>
          </span>
          {focus === "diversify" && (
            <CheckIcon aria-hidden size={14} className="shrink-0 text-accent" />
          )}
        </label>
        <p className={`${LABEL} px-3 pt-2 pb-1`}>Or focus on a sector</p>
        {SECTORS.map((sector) => (
          <label key={sector} title={sector} className={OPTION}>
            <input
              type="radio"
              name="focus"
              value={sector}
              checked={focus === sector}
              onChange={() => onFocus(sector)}
              className="sr-only"
            />
            <span aria-hidden className={`size-2 shrink-0 rounded-full ${SECTOR_COLORS[sector]}`} />
            <span className="min-w-0 flex-1 truncate">{SECTOR_SHORT[sector]}</span>
            {focus === sector && (
              <CheckIcon aria-hidden size={14} className="shrink-0 text-accent" />
            )}
          </label>
        ))}
      </fieldset>

      <div className="space-y-3 border-t border-rule/60 p-4">
        <div className="grid gap-1.5">
          <span className={LABEL}>Model</span>
          <FeatureModelPicker feature="ideas" label="Stock ideas model" disabled={loading} />
        </div>
        <Button
          variant="primary"
          size="md"
          className="w-full"
          onClick={onFind}
          disabled={loading}
          title={
            choice.provider === "claude"
              ? "Sends the tickers you hold and their share of your portfolio to Anthropic via your Claude Code CLI."
              : "Runs on this computer. With TAVILY_API_KEY set, Krestrel first searches the web (no holdings are sent)."
          }
        >
          <LightbulbIcon aria-hidden size={16} />
          <span className={loading ? "animate-pulse" : ""}>
            {loading ? `Searching… (${modelName})` : hasResult ? "Refresh ideas" : "Find ideas"}
          </span>
        </Button>
        <p className="text-xs text-muted">
          {choice.provider === "claude" ? "Takes 1–3 minutes." : "Runs on this computer."} Not
          financial advice.
        </p>
      </div>
    </aside>
  );
}
