// Alpaca payload → Krestrel types. Pure; nothing outside this folder sees Alpaca field names.
import { nyDay } from "~/lib/candles";
import type {
  Asset,
  Bar,
  BarSource,
  DailyBar,
  MarketClock,
  MarketPhase,
  NewsItem,
  QuoteSnapshot,
  Tick,
} from "~/lib/market";

import type { AlpacaAsset, Clock, NewsArticle, RestBar, Snapshot, TradeMessage } from "./schemas";

/**
 * RFC 3339 → epoch ms. Node 24's `Date.parse` accepts nanosecond fractions and truncates them
 * to ms (verified), so no pre-trimming is needed. Inputs are already Zod-validated.
 */
function toEpochMs(iso: string): number {
  return Date.parse(iso);
}

export function tradeToTick(trade: TradeMessage): Tick {
  return { symbol: trade.S, price: trade.p, size: trade.s, ts: toEpochMs(trade.t) };
}

/** Stream (`b`/`u`) and REST bars share one shape; the stream adds the symbol as `S`. */
export function toBar(symbol: string, bar: RestBar, source: BarSource): Bar {
  return {
    symbol,
    source,
    ts: toEpochMs(bar.t),
    open: bar.o,
    high: bar.h,
    low: bar.l,
    close: bar.c,
    volume: bar.v,
    tradeCount: bar.n ?? null,
    vwap: bar.vw ?? null,
  };
}

/**
 * REST `1Day` bar → DailyBar. Alpaca stamps daily bars at New York midnight (e.g.
 * `2021-02-22T05:00:00Z`); the trading date is that instant's New York calendar date.
 */
export function toDailyBar(symbol: string, bar: RestBar, source: BarSource): DailyBar {
  return {
    symbol,
    source,
    day: nyDay(toEpochMs(bar.t)),
    open: bar.o,
    high: bar.h,
    low: bar.l,
    close: bar.c,
    volume: bar.v,
  };
}

export function snapshotToQuote(symbol: string, snapshot: Snapshot): QuoteSnapshot {
  const trade = snapshot.latestTrade;
  return {
    symbol,
    lastPrice: trade?.p ?? null,
    lastTs: trade ? toEpochMs(trade.t) : null,
    previousClose: snapshot.prevDailyBar?.c ?? null,
  };
}

// Lunch is a session break some non-US markets have; NYSE never reports it, so if it ever
// appears the market is still in its trading day (ADR 0006).
const PHASES: Record<Clock["phase"], MarketPhase> = {
  pre: "pre",
  core: "open",
  lunch: "open",
  post: "post",
  closed: "closed",
};

export function clockToMarketClock(clock: Clock): MarketClock {
  return {
    phase: PHASES[clock.phase],
    phaseUntil: clock.phase_until ? toEpochMs(clock.phase_until) : null,
    nextOpen: clock.next_market_open ? toEpochMs(clock.next_market_open) : null,
    nextClose: clock.next_market_close ? toEpochMs(clock.next_market_close) : null,
  };
}

/** Exchanges whose listed equities Krestrel tracks (ai/market-data.md, asset validation). */
const SUPPORTED_EXCHANGES: Record<string, true> = {
  NYSE: true,
  NASDAQ: true,
  ARCA: true,
  AMEX: true,
  BATS: true,
  NYSEARCA: true,
};

/** `null` unless the asset is an active, tradable US equity on a supported exchange. */
export function assetToAsset(asset: AlpacaAsset): Asset | null {
  const eligible =
    asset.status === "active" &&
    asset.class === "us_equity" &&
    asset.tradable &&
    SUPPORTED_EXCHANGES[asset.exchange] === true;
  return eligible ? { symbol: asset.symbol, name: asset.name, exchange: asset.exchange } : null;
}

/** Alpaca's news feed is Benzinga's; an article without a public http(s) page gets no link. */
export function newsToNewsItem(article: NewsArticle): NewsItem {
  const url = article.url?.trim() ?? "";
  return {
    id: String(article.id),
    headline: article.headline.trim(),
    summary: article.summary?.trim() ?? "",
    source: article.source?.trim() || "benzinga",
    url: /^https?:\/\//i.test(url) ? url : null,
    createdAt: new Date(toEpochMs(article.created_at)).toISOString(),
  };
}
