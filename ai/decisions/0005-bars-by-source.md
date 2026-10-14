# 0005: Store bars per source

- Status: accepted (implemented in Phases 1–2)
- Date: 2026-10-14

## Context

The free plan provides two different views of the same minute:

- **Live stream, IEX only** (`wss://stream.data.alpaca.markets/v2/iex`). Real time, but IEX is roughly 2.5% of market volume, so volume and sometimes OHLC differ from the consolidated tape.
- **REST, SIP (all exchanges)** via `GET /v2/stocks/bars`. Complete, but the Basic plan only serves data older than 15 minutes.

Mixing them in one row would silently overwrite complete data with partial data, or the reverse.

## Decision

- `bars_1m` primary key is `(symbol, source, ts)`. `source` ∈ `alpaca_sip` (REST backfill) | `alpaca_iex` (live stream).
- Backfill requests **must pass `feed=sip` explicitly** and `end = now − 16 min`. (`feed` defaults to `sip` on `/v2/stocks/bars` today, but snapshots default to `iex` for free users; being explicit avoids depending on per-endpoint defaults.)
- Live `bars` (`T:"b"`) and late-trade corrections from `updatedBars` (`T:"u"`, same minute `t`) are upserted as `alpaca_iex`.
- Chart queries take `alpaca_sip` rows where they exist and fill only the most recent uncovered window (≈15 min) from `alpaca_iex`.
- Finnhub (future) gets its own `source` value; nothing in the key changes.

## Consequences

- Charts show complete volume for everything except the last ~15 minutes, and the UI labels live data as IEX-only.
- Storage roughly doubles for recent days (both sources kept). Negligible for ≤ 30 symbols.
- A periodic SIP re-backfill gradually replaces the IEX tail with complete data without deleting anything.
