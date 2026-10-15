# 0011: Daily history table for 1D…1Y intervals

- Status: accepted (owner request, 2026-10-14)
- Date: 2026-10-14

## Context

The owner asked for TradingView-style intervals including week, 2 weeks, month, and year. Kestrel/Krestrel originally stored only 1-minute bars (ADR 0003: "Store no other timeframes") for `BACKFILL_DAYS` (30). A yearly chart from minute bars would need years of them: ~960 bars/day × 252 days × 10 years × 30 symbols ≈ 72M rows, and thousands of REST pages per backfill.

## Decision

- Intervals: `1m 5m 15m 30m 1h 4h` (intraday, from `bars_1m`) and `1D 1W 2W 1M 1Y` (calendar, from daily history). Listed in `INTRADAY_TIMEFRAMES` / `CALENDAR_TIMEFRAMES` (`app/lib/market.ts`).
- New table `bars_1d(symbol, source, day date, open, high, low, close, volume)`, PK `(symbol, source, day)`. `day` is the New York trading date. Filled by a new provider method `getDailyBars(symbols, startDay, endDay)`; Alpaca: `GET /v2/stocks/bars?timeframe=1Day&feed=sip&adjustment=split`.
- Backfill runs a daily phase (last `DAILY_HISTORY_YEARS`, default 10, up to yesterday) before the minute phase; both incremental.
- Alpaca's date `end` is inclusive and covers the whole day, so the provider sends the day before the exclusive `endDay`, and the backfill computes `endDay` from `now − historyDelayMs`. Otherwise the request reaches into the running session and the free plan rejects it (`403 subscription does not permit querying recent SIP data`).
- Calendar candles: daily rows, plus days after the newest daily row (today, or anything not yet backfilled) built from minute bars, then rolled up by `aggregateDays` (`app/lib/candles.ts`). The browser uses the same functions for live updates, so server and client buckets cannot drift.
- Calendar rules (New York time): weeks start Monday; 2-week periods are fixed fortnights counted from Monday 2000-01-03; months/years start on the 1st / Jan 1. 30m/4h are UTC-aligned like the other intraday intervals.

## Consequences

- ~2,500 small rows per symbol for 10 years; one paginated request per batch of 30 symbols.
- Daily history is split-adjusted; minute bars are raw. Within the newest day the two never mix (minute-built days are only used after the last daily row), but a split on the current day would show a jump until the next daily backfill.
- Alpaca daily bars aggregate the trading day as Alpaca defines it; minute-built "today" includes extended hours. Today's 1D candle may therefore differ slightly from the daily bar that replaces it.
- Intraday intervals still only cover `BACKFILL_DAYS` of history.
- ADR 0003's "no stored rollups" is amended: daily bars are stored because they come from the provider, not computed from our own minutes.
