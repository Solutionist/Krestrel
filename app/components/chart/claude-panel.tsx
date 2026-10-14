import { SparkleIcon, WarningCircleIcon, XIcon } from "@phosphor-icons/react";
import { createStoredValue } from "~/hooks/stored-value";
import type { Analysis, Trade } from "~/lib/analysis";
import {
  CLAUDE_MODEL_LABELS,
  CLAUDE_MODELS,
  type ClaudeModel,
  type ExplainResponse,
} from "~/lib/analysis-explanation";

import { Button, IconButton } from "../ui/button";
import { FIELD, HEADING, LABEL } from "../ui/styles";

export type ClaudeState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "done"; result: Extract<ExplainResponse, { ok: true }> };

/** The owner's model choice for AI analysis, remembered across sessions. */
export const claudeModel = createStoredValue<ClaudeModel>(
  "krestrel.claudeModel",
  "default",
  (raw) => CLAUDE_MODELS.find((model) => model === raw) ?? null,
  (model) => model,
);

/** Claude's notes: a thin accent rule marks them as Claude's words, not computed facts. */
const NOTE = "border-l-2 border-accent/40 pl-2 text-sm text-pretty text-text";

/**
 * Claude's own column beside the chart (never over it, ADR 0012): a one-sentence summary and
 * ranked one-line suggestions on the locally computed trades and levels. Notes only show for the
 * exact trade/level they were written for; new candles mark them stale.
 */
export function ClaudePanel({
  analysis,
  symbol,
  claude,
  onAsk,
  onFocusTrade,
  onClose,
}: {
  analysis: Analysis | null;
  symbol: string;
  claude: ClaudeState;
  onAsk: () => void;
  onFocusTrade: (trade: Trade) => void;
  onClose: () => void;
}) {
  const result = claude.kind === "done" ? claude.result : null;
  const explained = result?.explanation ?? null;
  const snapshot = result?.analysis ?? null;
  const loading = claude.kind === "loading";
  const [model, setModel] = claudeModel.use();
  const modelName = CLAUDE_MODEL_LABELS[model].name;
  const canAsk = analysis !== null && analysis.pivots.length >= 2 && !loading;

  const current = (trade: Trade) =>
    analysis?.trades.find(
      (t) => t.id === trade.id && t.buy.time === trade.buy.time && t.sell.time === trade.sell.time,
    );
  const stale =
    snapshot !== null &&
    analysis !== null &&
    (snapshot.trades.some((trade) => !current(trade)) ||
      snapshot.levels.some(
        (level) =>
          !analysis.levels.some((l) => l.id === level.id && Math.abs(l.price - level.price) < 1e-6),
      ));
  const rankedTrades = explained ? [...explained.trades].sort((a, b) => a.rank - b.rank) : [];

  return (
    <aside
      id="chart-claude"
      aria-label="AI analysis"
      className="flex min-h-0 w-80 shrink-0 flex-col border-l border-rule/70"
    >
      <header className="flex items-center justify-between gap-2 px-4 pt-4 pb-2">
        <h2 className={`${HEADING} flex items-center gap-1.5`}>
          <SparkleIcon aria-hidden size={16} weight="fill" className="text-accent" />
          AI analysis
          <span className="font-normal text-muted">· Claude</span>
        </h2>
        <IconButton label="Close AI analysis" onClick={onClose} className="-mr-1.5">
          <XIcon aria-hidden size={14} />
        </IconButton>
      </header>

      <div
        aria-live="polite"
        className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 pt-1 pb-4 text-sm"
      >
        {claude.kind === "idle" && (
          <div className="space-y-3 pt-1">
            <p className="text-text">
              Claude reviews the {symbol} candles on screen and explains, in one line each:
            </p>
            <ul className="space-y-1.5 text-xs text-muted">
              <li>which past buy/sell points worked best, and why;</li>
              <li>which support and resistance levels matter;</li>
              <li>whether the trend is holding.</li>
            </ul>
            <p className="text-xs text-muted">
              Uses your Claude subscription. Only this chart's prices are sent. Usually 20–60 s.
            </p>
          </div>
        )}

        {loading && (
          <div className="space-y-3 pt-1">
            <span className="sr-only">Claude ({modelName}) is analyzing the chart.</span>
            {[92, 78, 85, 64, 80].map((width) => (
              <span
                key={width}
                aria-hidden
                className="block h-3 animate-pulse rounded-md bg-subtle"
                style={{ width: `${width}%` }}
              />
            ))}
          </div>
        )}

        {claude.kind === "error" && (
          <p className="flex items-start gap-1.5 text-fall">
            <WarningCircleIcon aria-hidden size={16} className="mt-px shrink-0" />
            {claude.message}
          </p>
        )}

        {explained && (
          <>
            <p className={NOTE}>{explained.summary}</p>
            {stale && (
              <p className="text-xs text-accent">
                New candles changed some points since these notes. Ask again to refresh them.
              </p>
            )}

            {rankedTrades.length > 0 && (
              <section aria-labelledby="claude-trades">
                <h3 id="claude-trades" className={`${LABEL} mb-1`}>
                  Ranked trades
                </h3>
                <ol className="-mx-2 space-y-0.5">
                  {rankedTrades.map((note) => {
                    const trade = snapshot?.trades.find((t) => t.id === note.id);
                    const live = trade ? current(trade) : undefined;
                    return (
                      <li key={note.id}>
                        <button
                          type="button"
                          disabled={!live}
                          onClick={() => live && onFocusTrade(live)}
                          title={
                            live
                              ? "Zoom the chart to this trade"
                              : "This trade changed since the note"
                          }
                          className="w-full rounded-lg p-2 text-left transition-colors duration-150 hover:bg-subtle active:translate-y-px disabled:opacity-60"
                        >
                          <span className="flex items-center gap-1.5 text-xs">
                            <span className="text-muted tabular-nums">#{note.rank}</span>
                            <span className="rounded-md bg-accent/10 px-1.5 py-0.5 font-medium text-accent">
                              {note.id}
                            </span>
                            {trade && (
                              <span className="ml-auto rounded-md bg-rise/10 px-1.5 py-0.5 font-medium text-rise tabular-nums">
                                ▲ +{(trade.returnFraction * 100).toFixed(1)}%
                              </span>
                            )}
                          </span>
                          <span className="mt-1.5 block text-sm text-pretty text-text">
                            {note.note}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ol>
              </section>
            )}

            {explained.levels.length > 0 && (
              <section aria-labelledby="claude-levels">
                <h3 id="claude-levels" className={`${LABEL} mb-1.5`}>
                  Levels
                </h3>
                <ul className="space-y-2">
                  {explained.levels.map((note) => {
                    const level = snapshot?.levels.find((l) => l.id === note.id);
                    return (
                      <li key={note.id} className="flex gap-2">
                        <span
                          className={`mt-px shrink-0 text-xs font-medium ${level?.kind === "support" ? "text-rise" : "text-fall"}`}
                        >
                          {note.id}
                        </span>
                        <span className="text-sm text-pretty text-text">{note.note}</span>
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}

            {explained.trend && (
              <section aria-labelledby="claude-trend">
                <h3 id="claude-trend" className={`${LABEL} mb-1`}>
                  Trend
                </h3>
                <p className={NOTE}>{explained.trend}</p>
              </section>
            )}
          </>
        )}
      </div>

      <footer className="space-y-3 border-t border-rule/60 p-4">
        <label className="grid gap-1.5">
          <span className={LABEL}>Model</span>
          <select
            value={model}
            onChange={(event) => {
              const next = CLAUDE_MODELS.find((option) => option === event.target.value);
              if (next) setModel(next);
            }}
            disabled={loading}
            className={`${FIELD} h-9 cursor-pointer`}
          >
            {CLAUDE_MODELS.map((option) => (
              <option key={option} value={option}>
                {CLAUDE_MODEL_LABELS[option].name} · {CLAUDE_MODEL_LABELS[option].hint}
              </option>
            ))}
          </select>
        </label>
        <Button
          variant="primary"
          size="md"
          className="w-full"
          onClick={onAsk}
          disabled={!canAsk}
          title="Sends this chart's candles to Anthropic via your Claude Code CLI."
        >
          <SparkleIcon aria-hidden size={16} />
          <span className={loading ? "animate-pulse" : ""}>
            {loading
              ? `Analyzing with ${modelName}…`
              : explained
                ? "Analyze again"
                : "Analyze this chart"}
          </span>
        </Button>
        <p className="text-xs text-muted">
          {result
            ? `${result.provider}${result.model ? ` · ${result.model}` : ""}. Hindsight, not advice.`
            : analysis && analysis.pivots.length < 2
              ? "Not enough history on this interval yet."
              : "Hindsight on past candles, not financial advice."}
        </p>
      </footer>
    </aside>
  );
}
