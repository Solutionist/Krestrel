import {
  ArrowUpRightIcon,
  ChartLineUpIcon,
  PlusIcon,
  WarningCircleIcon,
  WarningIcon,
} from "@phosphor-icons/react";
import { Link, useFetcher } from "react-router";

import { formatChange, formatPercentChange, formatPrice } from "~/lib/format";
import { type Idea, SECTOR_SHORT } from "~/lib/ideas";
import type { QuoteSnapshot } from "~/lib/market";
import { priceChange } from "~/lib/price-change";
import type { WatchlistActionResult } from "~/routes/api.watchlist";

import { Button } from "../ui/button";
import { LABEL } from "../ui/styles";
import { DIRECTION_GLYPH, DIRECTION_TEXT } from "../watchlist/watchlist-row";
import { SECTOR_COLORS } from "./sector-mix";

const IDEA_CARD = "flex flex-col gap-3 rounded-xl bg-subtle/60 p-4";

/**
 * One idea: what it is, today's price, why it is worth a look, how it fits the mix, the main
 * risk, a few numbers and Claude's sources; then watch it or open its chart.
 */
export function IdeaCard({
  idea,
  quote,
  watched,
}: {
  idea: Idea;
  /** Live quote from the stream (watched symbols); else the price captured with the idea. */
  quote: QuoteSnapshot | null;
  watched: boolean;
}) {
  const watch = useFetcher<WatchlistActionResult>();
  const live = quote ?? {
    symbol: idea.symbol,
    lastPrice: idea.lastPrice,
    lastTs: null,
    previousClose: idea.previousClose,
  };
  const change = priceChange(live);
  const added = watched || watch.data?.ok === true;
  const watchError = watch.data && !watch.data.ok ? watch.data.error.message : null;
  // Model-supplied links: only plain web URLs become clickable.
  const sources = idea.sources.filter((source) => /^https?:\/\//i.test(source.url));

  return (
    <article aria-labelledby={`idea-${idea.symbol}`} className={IDEA_CARD}>
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 id={`idea-${idea.symbol}`} className="flex items-baseline gap-2">
            <span className="font-semibold tracking-tight text-text">{idea.symbol}</span>
            <span className="truncate text-muted" title={idea.name}>
              {idea.name}
            </span>
          </h3>
          <p className="mt-1 flex items-center gap-2 text-xs text-muted">
            <span
              title={idea.sector}
              className="inline-flex items-center gap-1.5 rounded-md bg-panel px-1.5 py-0.5 font-medium text-text ring-1 ring-inset ring-rule/70"
            >
              <span aria-hidden className={`size-2 rounded-full ${SECTOR_COLORS[idea.sector]}`} />
              {SECTOR_SHORT[idea.sector]}
            </span>
            {idea.exchange}
          </p>
        </div>
        <div className="shrink-0 text-right tabular-nums">
          <p className="font-medium text-text">
            {live.lastPrice === null ? "—" : formatPrice(live.lastPrice)}
          </p>
          <p className={`text-xs ${change ? DIRECTION_TEXT[change.direction] : "text-muted"}`}>
            {change && live.previousClose !== null
              ? `${DIRECTION_GLYPH[change.direction]} ${formatChange(change.absolute, live.previousClose)} ${formatPercentChange(change.fraction)}`
              : "—"}
          </p>
        </div>
      </header>

      <p className="text-pretty text-text">{idea.thesis}</p>
      <div className="grid gap-1.5 text-pretty">
        <p className="text-text">
          <span className="text-muted">Fits because </span>
          {idea.fit}
        </p>
        <p className="flex items-start gap-1.5 text-text">
          <WarningIcon aria-hidden size={14} className="mt-0.5 shrink-0 text-fall/70" />
          <span>
            <span className="text-muted">Risk: </span>
            {idea.risk}
          </span>
        </p>
      </div>

      {idea.metrics.length > 0 && (
        <dl className="flex flex-wrap gap-x-5 gap-y-2">
          {idea.metrics.map((metric) => (
            <div key={metric.label} className="grid gap-0.5">
              <dt className={LABEL}>{metric.label}</dt>
              <dd className="text-sm font-medium text-text tabular-nums">{metric.value}</dd>
            </div>
          ))}
        </dl>
      )}

      <footer className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-1">
        <ul aria-label="Sources" className="flex min-w-0 flex-wrap gap-x-3 gap-y-1 text-xs">
          {sources.map((source) => (
            <li key={source.url} className="min-w-0">
              <a
                href={source.url}
                target="_blank"
                rel="noopener noreferrer"
                className="group inline-flex max-w-48 items-center gap-0.5 text-muted hover:text-accent"
              >
                <span className="truncate">{source.title}</span>
                <ArrowUpRightIcon aria-hidden size={12} className="shrink-0" />
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            </li>
          ))}
        </ul>
        {added ? (
          <Link
            to={`/?symbol=${encodeURIComponent(idea.symbol)}`}
            className="inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-accent transition-colors duration-150 hover:bg-accent/10"
          >
            <ChartLineUpIcon aria-hidden size={14} />
            Open chart
          </Link>
        ) : (
          <Button
            size="sm"
            disabled={watch.state !== "idle"}
            title={`Add ${idea.symbol} to your watchlist`}
            onClick={() =>
              watch.submit(
                { intent: "add", symbol: idea.symbol },
                { method: "post", action: "/api/watchlist", encType: "application/json" },
              )
            }
          >
            <PlusIcon aria-hidden size={14} />
            {watch.state === "idle" ? "Watch" : "Adding…"}
          </Button>
        )}
      </footer>
      {watchError && (
        <p role="alert" className="flex items-start gap-1.5 text-xs text-fall">
          <WarningCircleIcon aria-hidden size={14} className="mt-px shrink-0" />
          {watchError}
        </p>
      )}
    </article>
  );
}

/** Placeholder shaped like an idea card while Claude works. */
export function IdeaCardSkeleton() {
  return (
    <div aria-hidden className={IDEA_CARD}>
      <div className="flex justify-between gap-3">
        <span className="h-4 w-32 animate-pulse rounded-md bg-rule/60" />
        <span className="h-4 w-14 animate-pulse rounded-md bg-rule/60" />
      </div>
      <span className="h-3 w-20 animate-pulse rounded-md bg-rule/60" />
      <span className="h-3 w-full animate-pulse rounded-md bg-rule/60" />
      <span className="h-3 w-4/5 animate-pulse rounded-md bg-rule/60" />
      <span className="h-3 w-3/5 animate-pulse rounded-md bg-rule/60" />
    </div>
  );
}
