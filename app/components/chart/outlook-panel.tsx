import {
  ArrowUpRightIcon,
  ChartLineUpIcon,
  SparkleIcon,
  WarningCircleIcon,
  XIcon,
} from "@phosphor-icons/react";
import { createStoredValue } from "~/hooks/stored-value";
import { INTERVAL_RANGE, PERIOD_NAMES } from "~/lib/chart-ranges";
import { formatPrice } from "~/lib/format";
import type { Timeframe } from "~/lib/market";
import {
  CLAUDE_MODEL_LABELS,
  CLAUDE_MODELS,
  type ClaudeModel,
  type Consensus,
  type NewsTone,
  type Outlook,
  type OutlookResponse,
  SENTIMENTS,
  type Sentiment,
  type Stance,
} from "~/lib/outlook";

import { Button, IconButton, ToggleChip } from "../ui/button";
import { FIELD, HEADING, LABEL } from "../ui/styles";
import { CANDLE_NAMES } from "./chart-toolbar";
import { PlanLevels } from "./plan-levels";

export type OutlookState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "done"; result: Extract<OutlookResponse, { ok: true }> };

/** The owner's model choice for the AI outlook, remembered across sessions. */
export const claudeModel = createStoredValue<ClaudeModel>(
  "krestrel.claudeModel",
  "default",
  (raw) => CLAUDE_MODELS.find((model) => model === raw) ?? null,
  (model) => model,
);

/** Chip tints: rise/fall only with their ▲/▼ glyph; neutral states stay muted. */
const RISE_CHIP = "bg-rise/10 text-rise";
const FALL_CHIP = "bg-fall/10 text-fall";
const NEUTRAL_CHIP = "bg-subtle text-text";

const SENTIMENT_LABELS: Record<Sentiment, string> = {
  bearish: "▼ Bearish",
  somewhat_bearish: "▼ Somewhat bearish",
  neutral: "Neutral",
  somewhat_bullish: "▲ Somewhat bullish",
  bullish: "▲ Bullish",
};
const SENTIMENT_TINTS: Record<Sentiment, { step: string; text: string }> = {
  bearish: { step: "bg-fall", text: "text-fall" },
  somewhat_bearish: { step: "bg-fall/60", text: "text-fall" },
  neutral: { step: "bg-muted", text: "text-text" },
  somewhat_bullish: { step: "bg-rise/60", text: "text-rise" },
  bullish: { step: "bg-rise", text: "text-rise" },
};

const STANCE_CHIPS: Record<Stance, { label: string; tint: string }> = {
  buy: { label: "▲ Buy now", tint: RISE_CHIP },
  wait: { label: "Wait for a pullback", tint: NEUTRAL_CHIP },
  hold: { label: "Hold", tint: NEUTRAL_CHIP },
  trim: { label: "▼ Take profit", tint: FALL_CHIP },
  avoid: { label: "▼ Avoid", tint: FALL_CHIP },
};

const CONSENSUS_CHIPS: Record<Consensus, { label: string; tint: string }> = {
  strong_buy: { label: "▲ Strong buy", tint: RISE_CHIP },
  buy: { label: "▲ Buy", tint: RISE_CHIP },
  hold: { label: "Hold", tint: NEUTRAL_CHIP },
  sell: { label: "▼ Sell", tint: FALL_CHIP },
  strong_sell: { label: "▼ Strong sell", tint: FALL_CHIP },
  unknown: { label: "Unknown", tint: NEUTRAL_CHIP },
};

const NEWS_GLYPHS: Record<NewsTone, { glyph: string; tone: string; label: string }> = {
  positive: { glyph: "▲", tone: "text-rise", label: "Positive" },
  negative: { glyph: "▼", tone: "text-fall", label: "Negative" },
  neutral: { glyph: "●", tone: "text-muted", label: "Neutral" },
};

const CHIP = "inline-flex rounded-md px-1.5 py-0.5 text-xs font-medium";

/**
 * Claude's forward-looking take beside the chart (ADR 0016): news and analyst sentiment found
 * with web search plus Krestrel's own levels, turned into a buy/sell plan. Only runs on a click.
 */
export function OutlookPanel({
  symbol,
  timeframe,
  outlook,
  lastPrice,
  canAsk,
  planShown,
  onAsk,
  onTogglePlan,
  onClose,
}: {
  symbol: string;
  timeframe: Timeframe;
  outlook: OutlookState;
  /** Latest close of the analysed candles, for "% from the price". */
  lastPrice: number | null;
  /** Enough candles on this interval to ask. */
  canAsk: boolean;
  planShown: boolean;
  onAsk: () => void;
  onTogglePlan: () => void;
  onClose: () => void;
}) {
  const result = outlook.kind === "done" ? outlook.result : null;
  const loading = outlook.kind === "loading";
  const [model, setModel] = claudeModel.use();
  const modelName = CLAUDE_MODEL_LABELS[model].name;
  const last = lastPrice ?? result?.localPlan?.lastPrice ?? null;

  return (
    <aside
      id="chart-outlook"
      aria-label="AI outlook"
      className="flex min-h-0 w-80 shrink-0 flex-col border-l border-rule/70"
    >
      <header className="flex items-center justify-between gap-2 px-4 pt-4 pb-2">
        <h2 className={`${HEADING} flex items-center gap-1.5`}>
          <SparkleIcon aria-hidden size={16} weight="fill" className="text-accent" />
          AI outlook
          <span className="font-normal text-muted">· Claude</span>
        </h2>
        <IconButton label="Close AI outlook" onClick={onClose} className="-mr-1.5">
          <XIcon aria-hidden size={14} />
        </IconButton>
      </header>

      <div
        aria-live="polite"
        className="min-h-0 flex-1 space-y-6 overflow-y-auto px-4 pt-1 pb-4 text-sm"
      >
        {outlook.kind === "idle" && (
          <div className="space-y-3 pt-1">
            <p className="text-pretty text-text">
              Claude reads recent {symbol} news and analyst ratings with web search, adds Krestrel's
              levels from this chart, and returns the sentiment and a plan: where to buy, where the
              idea is wrong, and where to sell.
            </p>
            <p className="text-xs text-pretty text-muted">
              Uses {CANDLE_NAMES[timeframe]} candles over {PERIOD_NAMES[INTERVAL_RANGE[timeframe]]}{" "}
              (change the trading style in Insights). Takes 1 to 3 minutes and uses your Claude
              subscription.
            </p>
          </div>
        )}

        {loading && (
          <div className="space-y-3 pt-1">
            <p className="flex items-center gap-1.5 text-xs text-muted">
              <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-accent" />
              Reading news and analyst ratings…
              <span className="sr-only">Claude ({modelName}) is working on the outlook.</span>
            </p>
            {[88, 72, 94, 60, 80, 68].map((width) => (
              <span
                key={width}
                aria-hidden
                className="block h-3 animate-pulse rounded-md bg-subtle"
                style={{ width: `${width}%` }}
              />
            ))}
          </div>
        )}

        {outlook.kind === "error" && (
          <p className="flex items-start gap-1.5 text-fall">
            <WarningCircleIcon aria-hidden size={16} className="mt-px shrink-0" />
            {outlook.message}
          </p>
        )}

        {result && (
          <>
            <SentimentSection sentiment={result.outlook.sentiment} />
            <PlanSection
              plan={result.outlook.plan}
              lastPrice={last}
              planShown={planShown}
              onTogglePlan={onTogglePlan}
            />
            <AnalystsSection analysts={result.outlook.analysts} lastPrice={last} />
            {result.outlook.news.length > 0 && <NewsSection news={result.outlook.news} />}
            {result.outlook.risks.length > 0 && (
              <section aria-labelledby="outlook-risks">
                <h3 id="outlook-risks" className={`${LABEL} mb-1.5`}>
                  Risks
                </h3>
                <ul className="list-disc space-y-1 pl-4 text-pretty text-text marker:text-muted">
                  {result.outlook.risks.map((risk) => (
                    <li key={risk}>{risk}</li>
                  ))}
                </ul>
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
          disabled={!canAsk || loading}
          title="Sends the ticker, this chart's prices and recent headlines to Anthropic via your Claude Code CLI."
        >
          <SparkleIcon aria-hidden size={16} />
          <span className={loading ? "animate-pulse" : ""}>
            {loading ? `Working… (${modelName})` : result ? "Refresh outlook" : "Get outlook"}
          </span>
        </Button>
        <p className="text-xs text-muted tabular-nums">
          {result && (
            <span className="block">
              {[
                result.provider,
                result.model,
                new Date(result.generatedAt).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                }),
              ]
                .filter(Boolean)
                .join(" · ")}
              {" · "}Feed headlines: {result.feedHeadlines}
            </span>
          )}
          {!canAsk && !loading ? "Not enough history on this interval yet. " : ""}
          Not financial advice.
        </p>
      </footer>
    </aside>
  );
}

function SentimentSection({ sentiment }: { sentiment: Outlook["sentiment"] }) {
  const tint = SENTIMENT_TINTS[sentiment.overall];
  return (
    <section aria-labelledby="outlook-sentiment">
      <h3 id="outlook-sentiment" className={`${LABEL} mb-2`}>
        Sentiment
      </h3>
      <div aria-hidden className="flex gap-1">
        {SENTIMENTS.map((step) => (
          <span
            key={step}
            className={`h-1.5 flex-1 rounded-full ${step === sentiment.overall ? tint.step : "bg-subtle"}`}
          />
        ))}
      </div>
      <div aria-hidden className="mt-1 flex justify-between text-xs text-muted">
        <span>Bearish</span>
        <span>Bullish</span>
      </div>
      <p className={`mt-2 font-medium ${tint.text}`}>{SENTIMENT_LABELS[sentiment.overall]}</p>
      <p className="mt-0.5 text-pretty text-text">{sentiment.summary}</p>
    </section>
  );
}

function PlanSection({
  plan,
  lastPrice,
  planShown,
  onTogglePlan,
}: {
  plan: Outlook["plan"];
  lastPrice: number | null;
  planShown: boolean;
  onTogglePlan: () => void;
}) {
  const stance = STANCE_CHIPS[plan.stance];
  const low = plan.buyLow ?? plan.buyHigh;
  const high = plan.buyHigh ?? plan.buyLow;
  return (
    <section aria-labelledby="outlook-plan" className="rounded-lg bg-subtle/60 p-3">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h3 id="outlook-plan" className={HEADING}>
          Plan
        </h3>
        <span className={`${CHIP} ${stance.tint}`}>{stance.label}</span>
      </div>
      <PlanLevels
        lastPrice={lastPrice}
        buyZone={low !== null && high !== null ? { low, high } : null}
        stop={plan.stop === null ? null : { price: plan.stop }}
        targets={plan.targets.map((price) => ({ price }))}
        noZone="No buy zone for now."
      />
      <p className="mt-2 text-pretty text-text">{plan.rationale}</p>
      <ToggleChip pressed={planShown} onClick={onTogglePlan} className="mt-2">
        <ChartLineUpIcon aria-hidden size={14} />
        Show on chart
      </ToggleChip>
    </section>
  );
}

function AnalystsSection({
  analysts,
  lastPrice,
}: {
  analysts: Outlook["analysts"];
  lastPrice: number | null;
}) {
  const consensus = CONSENSUS_CHIPS[analysts.consensus];
  const { targetLow: low, targetHigh: high, targetMean: mean } = analysts;
  const facts = [
    analysts.analystCount === null ? null : `${analysts.analystCount} analysts`,
    analysts.asOf ? `as of ${analysts.asOf}` : null,
  ].filter(Boolean);

  // Scale spans the target range and the current price, so both markers always fit.
  const marks = [low, high, mean, lastPrice].filter((value) => value !== null);
  const min = Math.min(...marks);
  const max = Math.max(...marks);
  const at = (value: number) => (max > min ? ((value - min) / (max - min)) * 100 : 50);

  return (
    <section aria-labelledby="outlook-analysts">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 id="outlook-analysts" className={LABEL}>
          Analysts
        </h3>
        <span className={`${CHIP} ${consensus.tint}`}>{consensus.label}</span>
      </div>
      {low !== null && high !== null && (
        <div className="mb-2">
          <div className="relative h-5">
            <span aria-hidden className="absolute inset-x-0 top-2 h-1 rounded-full bg-subtle" />
            <span
              aria-hidden
              className="absolute top-2 h-1 rounded-full bg-accent/30"
              style={{ left: `${at(low)}%`, width: `${at(high) - at(low)}%` }}
            />
            {mean !== null && (
              <span
                aria-hidden
                title={`Mean target ${formatPrice(mean)}`}
                className="absolute top-1 h-3 w-0.5 -translate-x-1/2 rounded-full bg-accent"
                style={{ left: `${at(mean)}%` }}
              />
            )}
            {lastPrice !== null && (
              <span
                aria-hidden
                title={`Price ${formatPrice(lastPrice)}`}
                className="absolute top-1.5 size-2 -translate-x-1/2 rounded-full bg-text ring-2 ring-panel"
                style={{ left: `${at(lastPrice)}%` }}
              />
            )}
          </div>
          <div className="flex justify-between text-xs text-muted tabular-nums">
            <span>Low {formatPrice(low)}</span>
            {mean !== null && <span className="text-accent">Mean {formatPrice(mean)}</span>}
            <span>High {formatPrice(high)}</span>
          </div>
          <p className="sr-only">
            Price targets from {formatPrice(low)} to {formatPrice(high)}
            {mean !== null && `, mean ${formatPrice(mean)}`}
            {lastPrice !== null && `; price now ${formatPrice(lastPrice)}`}.
          </p>
        </div>
      )}
      {facts.length > 0 && <p className="text-xs text-muted tabular-nums">{facts.join(" · ")}</p>}
      {analysts.note && <p className="mt-1 text-pretty text-text">{analysts.note}</p>}
    </section>
  );
}

function NewsSection({ news }: { news: Outlook["news"] }) {
  return (
    <section aria-labelledby="outlook-news">
      <h3 id="outlook-news" className={`${LABEL} mb-1`}>
        News
      </h3>
      <ul className="-mx-2 space-y-0.5">
        {news.map((item) => {
          const tone = NEWS_GLYPHS[item.tone];
          // Model-supplied links: only plain web URLs become clickable.
          const linkable = /^https?:\/\//i.test(item.url);
          return (
            <li key={`${item.url}-${item.headline}`} className="flex gap-2 rounded-lg p-2">
              <span aria-hidden className={`mt-px shrink-0 text-xs ${tone.tone}`}>
                {tone.glyph}
              </span>
              <div className="min-w-0">
                <span className="sr-only">{tone.label}: </span>
                {linkable ? (
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group text-pretty text-text hover:text-accent"
                  >
                    {item.headline}
                    <ArrowUpRightIcon
                      aria-hidden
                      size={12}
                      className="ml-0.5 inline align-baseline text-muted group-hover:text-accent"
                    />
                    <span className="sr-only"> (opens in a new tab)</span>
                  </a>
                ) : (
                  <span className="text-pretty text-text">{item.headline}</span>
                )}
                <p className="mt-0.5 text-xs text-muted tabular-nums">
                  {item.source} · {item.date}
                </p>
                {item.why && <p className="mt-0.5 text-xs text-pretty text-text">{item.why}</p>}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
