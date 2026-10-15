# Architecture

Status: Phases 1–2 implemented (database, providers, hub, SSE/JSON routes). UI (Phase 3) and alert engine (Phase 4) pending.

## Data flow

```
                       ┌──────────────────────── Node server (one process) ─────────────────────────┐
Upstream stream ──────►│ Provider (registry: MARKET_PROVIDER)                                         │
  (Alpaca IEX WS,      │   normalize → Tick / Bar / ConnectionStatus                                 │
   or MockProvider)    │        │                                                                    │
Upstream REST ────────►│   getBars / getSnapshots / getClock / getAsset                              │
                       │        ▼                                                                    │
                       │ MarketHub (globalThis singleton) ──► BarWriter ──► bars_1m (live source)    │
                       │   │  watchlist, quotes, clock      ──► Backfiller ─► bars_1m (history src)  │
                       │   │                                 (AlertEngine, Phase 4)                  │
                       │   └─► listeners ──► /api/stream (SSE) ─────────────────────────────────────┼─► EventSource
                       │ /api/bars/:symbol ◄── getCandles (SQL date_bin/date_trunc) ◄── PostgreSQL  │
                       │ /api/watchlist (POST add/remove/reorder) ──► hub ──► DB + provider.subscribe│
                       └────────────────────────────────────────────────────────────────────────────┘
```

## Modules

| Module | Responsibility |
|---|---|
| `app/lib/market.ts` | Isomorphic normalized types + Zod schemas (`Tick`, `Bar`, `ConnectionStatus`, `MarketClock`, `QuoteSnapshot`, `Asset`, `NewsItem`, `ProviderInfo`, `Candle`, `SymbolSchema`, `TIMEFRAMES`). No provider names |
| `app/lib/stream-events.ts` | SSE contract: event names → Zod payload schemas |
| `app/.server/env-schema.ts` / `env.ts` | App env (Zod), `parseConfig` used by providers; `env.ts` loads `.env` via `process.loadEnvFile()` and fails fast |
| `app/.server/logger.ts` | pino; pretty stream in dev, JSON in prod; generic secret redaction |
| `app/.server/market/db/*` | `schema.ts`, pure `client.ts` (`createDatabase`), `instance.ts` (app pool on globalThis), `migrate.ts`, `queries/` |
| `app/.server/market/provider.ts` | `MarketDataProvider` contract (ADR 0009) |
| `app/.server/market/registry.ts` | `MARKET_PROVIDER` id → factory |
| `app/.server/market/alpaca/` | Alpaca stream + REST, schemas, normalizers, config |
| `app/.server/market/mock/` | Deterministic simulated provider (offline dev, E2E) |
| `app/.server/market/backoff.ts` | Full-jitter exponential backoff |
| `app/.server/market/hub.ts` | `MarketHub`: watchlist (limit = provider `maxSymbols`), quotes, clock polling, fan-out, `getNews` (last 30 days, ≤ 20, `[]` on failure), `warmAssets` / `verifyListed` (exact tickers against the cached listing, falling back to per-ticker lookups when the listing can't load; tickers it couldn't check are left out of the map so callers keep them; no watchlist change), `getQuotes` (one-off snapshots without subscribing, empty on failure) |
| `app/.server/market/bar-writer.ts` | Coalesces live bars (250 ms) → idempotent upsert |
| `app/.server/market/asset-search.ts` | In-memory ticker/company index (`createAssetIndex`) used by `hub.searchAssets` |
| `app/.server/market/backfill.ts` | Incremental history backfill, serialized, every 15 min + on add |
| `app/.server/market/instance.ts` | `getMarketHub()` — the only way to reach market data |
| `app/lib/portfolio.ts` | Trade ledger maths: `computePositions` (average cost, oversell check), `mergePositions`, `valuePosition`, `portfolioTotals` (ADR 0013) |
| `app/.server/portfolio-import/vision.ts` | Holdings from a broker screenshot: `readHoldingsFromImage` (open vision model on the owner's loopback Ollama, JSON-schema answer, Zod-validated), `cleanHoldings` (ticker normalising, null misreads, de-dupe) (ADR 0018) |
| `app/lib/rsi-signal.ts` | RSI levels schema, `rsiSignal`/`rsiCrosses` (zones and buy/sell when RSI leaves a zone), `liveCloses` (ADR 0014) |
| `app/lib/currency.ts` | Display currency: `formatMoney`, `currencyName`, `/api/fx` schema |
| `app/.server/fx/` | `FxRateCache`: ECB daily USD rates via Frankfurter, 6 h cache, stale-on-failure (ADR 0013) |
| `app/lib/analysis.ts` | Hindsight analysis: swing pivots, best round trips (DP), support/resistance, trend support |
| `app/lib/trade-plan.ts` | Rule-based forward plan from the analysis: bias, buy zone, stop, targets, reward:risk (ADR 0016) |
| `app/lib/outlook.ts` | AI outlook contract: `OutlookSchema` (model output), request/response schemas, model aliases, text budgets (ADR 0016) |
| `app/lib/ideas.ts` | Stock ideas contract: GICS `SECTORS`, focuses, growth/dividend/risky categories, `IdeasModelSchema` (model output), request/response schemas, text budgets (ADR 0017) |
| `app/.server/llm/` | LLM backends (`LlmClient`), `claude-cli` via the user's Claude Code CLI; `getLlm()`. Requests may enable `WebSearch`/`WebFetch` and set their own timeout |
| `app/.server/analysis/outlook.ts` | Outlook prompt (levels, local plan, indicators, feed headlines, web-research task), `sanitizeOutlook` (budgets, http(s) links, price bands), `generateOutlook` |
| `app/.server/analysis/ideas.ts` | Ideas: starting mix (`openPositions` across portfolios, `holdingWeights` by value, cost basis when unpriced), prompt (symbols + percent weights only, focus, web-research task), `sanitizeIdeas` (valid unique tickers, not held, in focus, budgets, http(s) sources, ≤ 10), `generateIdeas` |
| `app/.server/startup.ts` | Boot: migrations → hub start → SIGTERM/SIGINT shutdown |
| `app/entry.server.tsx` | Calls `await startServer()` at module scope |
| `app/routes/api.*.ts` | `stream` (SSE), `bars.$symbol` (JSON), `outlook.$symbol` (AI outlook), `ideas` (AI stock ideas), `watchlist` and `portfolios` (actions), `portfolio-import` (screenshot → holdings via local vision model), `signals`, `fx`, `health` |

## Startup and singleton (ADR 0004)

`entry.server.tsx` → `startServer()` (memoized on `globalThis`) → `runMigrations` → `getMarketHub().start()`. Under `react-router-serve` this runs at process start; under `react-router dev` on the first request (Vite loads the server build lazily). The hub and DB pool live on `globalThis`, so HMR edits (verified: edits to a route, `hub.ts`, `instance.ts`) never create a second hub or upstream connection.

## SSE contract (`/api/stream`)

`event: <name>\ndata: <json>\n\n`; payload schemas in `app/lib/stream-events.ts`.

| Event | Payload | When |
|---|---|---|
| `snapshot` | `{ provider, status, clock, watchlist, quotes }` | First message on every (re)connect |
| `tick` | `Tick` | Each trade for a watched symbol |
| `bar` | `Bar` (1m, live source) | Each completed/corrected minute |
| `status` | `ConnectionStatus` | Upstream state change |
| `market` | `MarketClock` | Each clock poll (phase boundaries) |
| `quote` | `QuoteSnapshot` | Snapshot refresh (start, symbol add, phase change) |
| `watchlist` | `{ symbols }` | Add/remove/reorder |
| `history` | `{ symbols }` | History download finished after startup or a symbol add; open charts reload once |
| `alert` | Phase 4 | Alert fired |

Plus `: ping` every 15 s. Headers include `Cache-Control: no-cache, no-transform` so `react-router-serve`'s compression doesn't buffer. On hub shutdown every stream is closed.

## HTTP API

| Route | Method | Notes |
|---|---|---|
| `/api/bars/:symbol?tf=1m…4h\|1D\|1W\|2W\|1M\|1Y[&from&to]` | GET | Candles (`time` = epoch seconds). Intraday from `bars_1m`; calendar intervals from `bars_1d` + today's minutes (ADR 0011). Default look-back per interval (2 d … 30 y). 400 on bad input |
| `/api/assets?q=a[&limit=8]` | GET | Symbol search over the provider listing: exact ticker, ticker prefix (shortest first), then company-name words (≥ 2 chars). 502 with a plain message if the listing can't load |
| `/api/outlook/:symbol` | POST | `OutlookRequest` `{ timeframe, candles (20…6000, the Insights window), model? }` (`model` = default \| haiku \| sonnet \| opus \| fable → CLI `--model`, overriding CLAUDE_MODEL) → `{ ok, provider, model, localPlan, outlook, feedHeadlines, generatedAt }`. The server re-windows the candles (`analysisWindow`), runs `analyzeChart` + `buildTradePlan`, adds the hub's last 30 days of headlines, and runs Claude with only `WebSearch`/`WebFetch` (5 min timeout); the answer is schema-validated then sanitised (ADR 0016). Errors `{ ok:false, error:{code,message} }`: `invalid` 400, `not_enough_data` 422, `not_signed_in`/`not_installed`/`disabled` 503, `busy`/`rate_limited` 429, `timeout` 504, `invalid_output`/`failed` 502 |
| `/api/ideas` | POST | `IdeasRequest` `{ focus? (diversify \| GICS sector), model? }` → `{ ok, provider, model, focus, basis, holdings, sectorWeights, summary, suggestedSectors, ideas, generatedAt }`. Starting mix: open holdings across all portfolios weighted by value (basis `portfolio`), else the watchlist equally weighted (`watchlist`), else `none`; only symbols and percent weights go to Claude. Claude runs with only `WebSearch`/`WebFetch` (5 min timeout); the answer is schema-validated and sanitised, then every ticker is checked against the provider listing (loaded in the background while Claude works; per-ticker lookups when it can't load): unlisted ones are dropped, ones that couldn't be checked are kept with an empty `exchange`, quoted without subscribing, and flagged `watched` (ADR 0017). Errors as `/api/outlook` plus `invalid_output` 502 when fewer than 3 listed ideas survive |
| `/api/watchlist` | GET | `{ symbols, provider }` |
| `/api/watchlist` | POST | JSON or form: `{intent:"add",symbol}` / `remove` / `reorder` (`symbols[]`). Typed errors: `invalid`/`unknown` 422, `duplicate` 422, `limit` 409, `upstream` 502, `stale` 409 |
| `/api/portfolios` | POST | JSON: `{intent:"create",name}` / `rename` (`id,name`) / `delete` (`id`) / `addTrade` (`portfolioId`, trade) / `updateTrade` (`id`, trade) / `deleteTrade` (`id`) / `importTrades` (`portfolioId`, `trades[≤100]`, all or nothing); trade = `{symbol, side, shares, price, fee, tradedOn}` in USD. Recording a trade adds the symbol to the watchlist. Typed errors: `invalid` 400, `duplicate` 409, `oversell` 409, `unknown_symbol` 422, `not_found` 404; `{ok:true, warning}` when saved but unpriced |
| `/api/portfolio-import` | POST | multipart `image` (PNG/JPEG/WebP ≤ 20 MB, shrunk to ≤ 3.2 MP in the browser) → `{ok:true, holdings:[{symbol, shares\|null, averageCost\|null}], warning?}` (warning when costs aren't USD); saves nothing. Errors: `invalid` 400, `too_large` 413, `unsupported` 415, `nothing_found` 422, `unavailable`/`model_missing`/`config` 503, `timeout` 504, `invalid_output`/`failed` 502 (ADR 0018) |
| `/api/signals` | GET | `{series: {SYMBOL: {closes (≈1 year of daily closes, oldest first), lastTime}}}` for watchlist symbols; the browser computes daily RSI signals with live prices (ADR 0014) |
| `/api/fx` | GET | `{ok:true, fx:{rates (per 1 USD, incl. USD), date, source}}` or 502 `{ok:false,error}` |
| `/api/health` | GET | 200/503 by DB; includes upstream status |

`/api/portfolios` and `/api/portfolio-import` refuse requests sent by pages from another origin (`crossSiteRejection` in `app/.server/same-origin.ts`: `Sec-Fetch-Site`, else `Origin` vs. host → 403 `cross_site`). Browsers send `text/plain` and multipart POSTs to 127.0.0.1 without a CORS preflight, so without this any website could run these actions. Clients without those headers (curl, tests) pass.

## Reconnect strategy

Inside each provider. Alpaca: full-jitter backoff base 1 s cap 60 s, counter reset after auth; 15 s handshake timeout; re-auth + resubscribe full set after reconnect.

| Alpaca code | Handling | Status → UI |
|---|---|---|
| 402 auth failed / 409 insufficient subscription | Terminal, no retry | `error` + what to fix in `.env` |
| 406 connection limit | Retry after exactly 60 s | `error`, code 406, `retryAt` |
| 405 symbol limit | Keep connection | `live` with code 405 + reason |
| 404, 407, 500, close, network | Backoff | `reconnecting` + `retryAt` |

## Failure modes

- Upstream down → `status` events; chart keeps last data; history still served from DB.
- DB down at boot → startup fails with "is Postgres running? `bun run db:up`"; retried on next request in dev. DB down later → `/api/health` 503; bar writes logged and recovered by next backfill.
- Clock request fails → retried every minute.
- Live bar write fails → logged; the next SIP backfill covers the gap.
