# Market data (Alpaca, free Basic plan)

Sources: docs.alpaca.markets — streaming-market-data, real-time-stock-pricing-data, about-market-data-api, reference/stockbars, stocksnapshots, clock (v2/v3), calendar, assets, news. Context7 `/websites/alpaca_markets_us`. Verified 2026-10-14.

## Plan limits

| Limit | Value |
|---|---|
| Stream connections | **1** (second → error 406) |
| Stream symbols | **30** (over → error 405, existing subscriptions unchanged) |
| Real-time feed | **IEX only** (~2.5% of volume) |
| SIP historical | Only data older than **15 minutes** |
| REST rate | **200 req/min**; headers `X-RateLimit-Limit/Remaining/Reset`; 429 on exceed |

Paper-account keys work for market data. Data host is the same for paper and live.

## Stream

- URL: `wss://stream.data.alpaca.markets/v2/iex`. Always-on test stream: `wss://stream.data.alpaca.markets/v2/test`, symbol `FAKEPACA` (still needs auth).
- On open: `[{"T":"success","msg":"connected"}]`.
- Auth within **10 s**: `{"action":"auth","key":"…","secret":"…"}` → `[{"T":"success","msg":"authenticated"}]`. Handshake-header auth (`APCA-API-KEY-ID`/`APCA-API-SECRET-KEY`) also exists, but the standard `WebSocket` constructor has no headers option; use the auth message.
- Subscribe (additive): `{"action":"subscribe","trades":["AAPL"],"bars":["AAPL"],"updatedBars":["AAPL"]}`. Unsubscribe: same shape, `"action":"unsubscribe"`.
- Confirmation returns the **full** current set: `[{"T":"subscription","trades":[…],"bars":[…],…}]`. Keys may be missing (test stream) → all optional in the schema.
- Every frame is a JSON **array** of messages; data frames may batch many.

### Messages handled

| `T` | Channel | Fields | Use |
|---|---|---|---|
| `t` | trades | `S` sym, `i` id, `x` exch, `p` price, `s` size, `c` conditions[], `t` time, `z` tape | `Tick` |
| `b` | bars | `S,o,h,l,c,v,n,vw,t` (`t` = minute **start**) | `Bar` (1m) |
| `u` | updatedBars | same as `b`; late-trade correction of an earlier minute | upsert same key |
| `c` | corrections (auto with trades) | `S,x,oi,op,os,oc,ci,cp,cs,cc,t,z` | log; no price rollback in MVP |
| `x` | cancelErrors (auto with trades) | `S,i,x,p,s,a,t,z` | log |
| `success`, `subscription`, `error` | control | see above | status |

Unknown `T` values: ignore at debug level (check the envelope `T` before the discriminated union; Zod 4 returns `invalid_union` for unknown discriminators).

Timestamps are RFC 3339 with variable fraction digits (ms or ns). Validate with `z.iso.datetime()` (no `precision`), normalize to epoch ms.

### Error codes (`[{"T":"error","code":N,"msg":"…"}]`)

400 invalid syntax · 401 not authenticated · 402 auth failed · 403 already authenticated · 404 auth timeout · 405 symbol limit exceeded · 406 connection limit exceeded · 407 slow client · 409 insufficient subscription · 410 invalid subscribe action · 500 internal error. Docs do not say which close the socket; handling is in `ai/architecture.md`.

## REST

Headers: `APCA-API-KEY-ID`, `APCA-API-SECRET-KEY`.

| Endpoint | Notes |
|---|---|
| `GET https://data.alpaca.markets/v2/stocks/bars` | `symbols`, `timeframe=1Min`, `start`, `end`, `limit` ≤ 10000 **across all symbols**, `feed` (**default `sip`**; always pass explicitly), `adjustment=raw`, `sort=asc`, `page_token`. Response `{ bars: { SYM: [{t,o,h,l,c,v,n,vw}] }, next_page_token }`, sorted by symbol then time → always paginate |
| `GET https://data.alpaca.markets/v2/stocks/snapshots?symbols=…&feed=iex` | **Top-level map** `{ SYM: { latestTrade, latestQuote, minuteBar, dailyBar, prevDailyBar } }`. Previous close = `prevDailyBar.c` |
| `GET https://data.alpaca.markets/v1beta1/news?symbols=SYM&start=ISO&limit=20&sort=desc&include_content=false` | Benzinga headlines (same keys, free plan). Response `{ news: [{ id (number), headline, summary, source ("benzinga"), url ("" when none), created_at, updated_at, author, symbols, images, content }], next_page_token }` (shape verified live 2026-10-14). Only the first page is read; feeds the AI outlook (ADR 0016) |
| `GET https://data.alpaca.markets/v1/corporate-actions?symbols=…&types=cash_dividend&start=YYYY-MM-DD&end=YYYY-MM-DD&limit=1000&sort=asc` | Cash dividends (same keys; works on the owner's plan, verified live 2026-10-15). `start`/`end` filter on `process_date` (about the pay date), so a window ahead returns announced payments. Response `{ corporate_actions: { cash_dividends: [{ symbol, rate, special, foreign, ex_date, record_date, payable_date, process_date, cusip, id }] }, next_page_token }`; paginated, ≤ 100 symbols per request. Feeds the dividend schedule (ADR 0022) |
| `GET {trading}/v3/clock?markets=NYSE` | `phase` ∈ `pre|core|lunch|post|closed`, `phase_until` (ADR 0006) |
| `GET {trading}/v2/assets?status=active&asset_class=us_equity` | Full listing (~11k) for symbol search; entries validated one by one, ineligible ones dropped |
| `GET {trading}/v2/assets/{symbol}` | Validation on add: `status=active`, `class=us_equity`, `exchange` ∈ NYSE/NASDAQ (+ ARCA/AMEX/BATS/NYSEARCA if allowed), `tradable`. 404 = unknown |

`{trading}` = `https://paper-api.alpaca.markets` (paper keys) or `https://api.alpaca.markets` (live keys).

## Normalization rules

- Provider modules output only internal types (`app/lib/market.ts`); nothing outside `market/alpaca/` sees Alpaca field names.
- Prices as JS numbers; DB stores `numeric(14,4)` (ADR 0008).
- Times as epoch ms UTC; bar `ts` = minute start. `getBars` returns `[start, end)` (Alpaca's `end` is inclusive; the provider drops the boundary bar).

## `source` semantics

`alpaca_sip` = REST backfill (complete market, ≥ 16 min old). `alpaca_iex` = live stream (IEX only; `alpaca_sip` if `ALPACA_STREAM_FEED=sip`). Mock: `mock_hist` / `mock_live`. See ADR 0005.

## Alpaca implementation notes (`app/.server/market/alpaca/`)

- `config.ts`: owns `ALPACA_KEY_ID`, `ALPACA_SECRET_KEY`, `ALPACA_STREAM_FEED`, `ALPACA_TRADING_URL`, plus optional `ALPACA_DATA_URL`, `ALPACA_STREAM_URL` overrides.
- `schemas.ts` `parseStreamFrame` never throws: unknown `T` → debug, invalid known `T` → warn.
- REST calls spaced ≥ 350 ms; HTTP 429 waits for `X-RateLimit-Reset` (≤ 3 retries). Errors never include headers.
- `getNews` → `NewsItem { id, headline, summary, source, url (http(s) only, else null), createdAt (ISO) }`, newest first. The hub asks for the last 30 days (≤ 20) and returns `[]` on any failure, since news is optional context.
- `getDividends` → `{ symbol, exDate, payDate | null, amount (rate), special }`, oldest first. The hub caches each symbol for 6 h and leaves symbols out (unknown) on failure (ADR 0022). `hub.getDividendHistory(symbols, fromDay)` asks the same method for `[fromDay, today]` with its own 6 h cache, for dividends received (ADR 0025).
- `getDailyBars` also serves `hub.getDailyCloses(symbols, fromDay)` for portfolio performance (ADR 0024): any symbol, watched or not, downloading only the days missing from `bars_1d` (head before the first stored day, tail after the last), remembered per process; `getSnapshots` adds today's latest price. REST only, so it never touches the one stream.
- Tests inject `openSocket` / `fetch` / `now` / `random` / `sleep`. Fixtures in `tests/fixtures/alpaca/` are copied from the docs examples, not live recordings (`rest-news.json` follows a live response's shape).

## Provider contract (ADR 0009)

`app/.server/market/provider.ts`. A provider declares capabilities (`id`, `displayName`, `liveDataLabel`, `maxSymbols`, `liveSource`, `historySource`, `historyDelayMs`, `maxSymbolsPerHistoryRequest`) and implements `connect(handlers)`, `disconnect()`, `subscribe`, `unsubscribe`, `getBars` (async-iterable pages), `getDailyBars` (daily history by New York date, ADR 0011), `getSnapshots`, `getClock`, `getAsset`, `listAssets` (full listing for symbol search; the hub caches it for 24 h), `getNews(symbol, since, limit)` (recent headlines, newest first; the mock serves a few labelled simulated ones without links), `getDividends(symbols, startDay, endDay)` (cash dividends, oldest first; the mock simulates deterministic payers, ADR 0022). Factories receive `{ env, logger }` and validate their own variables with `parseConfig`. They must not import `~/.server/env`, `logger`, or `db`.

## Adding a provider (e.g. Finnhub) — checklist

1. `app/.server/market/finnhub/`: `config.ts` (own Zod schema via `parseConfig`), `schemas.ts`, `normalize.ts`, `provider.ts` exporting `createFinnhubProvider(context, deps)`.
2. Pick unique `liveSource` / `historySource` ids (e.g. `finnhub_live`, `finnhub_hist`). No migration.
3. Declare honest capabilities: `maxSymbols` (stream limit), `historyDelayMs`, `liveDataLabel`.
4. Map upstream errors to `ConnectionStatus` with plain-language `reason`; terminal vs. retry is the provider's call.
5. One line in `app/.server/market/registry.ts`; its variables in `.env.example` under a `# --- Provider: finnhub ---` heading.
6. Fixture-based tests for parsing, handshake, reconnect/resubscribe, pagination, config errors (see `alpaca/*.test.ts`).
7. Update this file. Hub, DB, routes, and UI need no change.
