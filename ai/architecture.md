# Architecture

Status: Phases 1–4 implemented (database, providers, hub, SSE/JSON routes, UI, alert engine). E2E and CI (Phase 5) pending.

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
                       │   │  live ticks ──► AlertEngine ──► alerts (fire once) ──► `alert` event    │
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
| `app/.server/market/alert-engine.ts`, `app/lib/alerts.ts` | Price alerts (ADR 0023): `AlertEngine` (active alerts in memory by symbol; each tick checks above ≥ / below ≤ target; `markAlertTriggered`'s conditional update makes each alert fire once, then the hub emits `alert`), reached through `hub.alerts` (`create` / `delete` / `list`); `app/lib/alerts.ts` holds the schemas, `ALERT_MET` and the fired-alert wording |
| `app/.server/market/asset-search.ts` | In-memory ticker/company index (`createAssetIndex`) used by `hub.searchAssets` |
| `app/.server/market/backfill.ts` | Incremental history backfill, serialized, every 15 min + on add: daily bars fill the tail after the newest stored day and, once per process, the head back to `DAILY_HISTORY_YEARS` (stored only when complete); 1-minute bars resume from the newest stored bar |
| `app/.server/market/instance.ts` | `getMarketHub()` — the only way to reach market data |
| `app/lib/portfolio.ts` | Trade ledger maths: `computePositions` (average cost, oversell check), `mergePositions`, `valuePosition`, `portfolioTotals` (ADR 0013) |
| `app/lib/rebalance.ts`, `app/.server/market/db/queries/portfolio-targets.ts`, `app/hooks/use-portfolio-targets.ts` | Target allocation per portfolio (ADR 0026): `TargetsSchema`, `planRebalance` (buy-only water-fill or buy-and-sell; exact and whole shares), `currentWeights`; targets stored in `portfolio_targets` (replace-all) |
| `app/lib/ai.ts` | AI choice contract (ADR 0020): `AiChoice` (Claude alias or local model), features, `LOCAL_MODEL_PRESETS` (Large/Medium/Small), defaults, research modes, `AiStatus` |
| `app/lib/pii.ts` | Personal-data rules for anything sent to Claude (ADR 0021): `redactPii` (email, phone, SSN, card/Luhn, IBAN/mod-97, labelled account numbers; counts by kind) and `ocrLineVerdict` (which screenshot lines and words Claude may see) |
| `app/components/portfolio/mask-screenshot.ts` | Browser-only: `maskForClaude` runs on-device OCR (tesseract.js, assets from `/ocr/*`) and returns a black canvas with only holdings rows and headers copied back (ADR 0021) |
| `app/.server/portfolio-import/vision.ts` | Holdings from a broker screenshot: `readHoldingsFromImage(llm, image)` (prompt + answer shape on any `LlmClient`), `cleanHoldings` (ticker normalising, null misreads, de-dupe), currency marks (ADR 0018) |
| `app/.server/stock-profiles/classify.ts`, `app/lib/stock-profile.ts` | Sector (GICS) and type (growth/dividend/risky) per ticker from the grouping AI; `groupHoldings` for the holdings table; owner corrections win (ADR 0019) |
| `app/lib/rsi-signal.ts` | RSI levels schema, `rsiSignal`/`rsiCrosses` (zones and buy/sell when RSI leaves a zone), `liveCloses` (ADR 0014) |
| `app/lib/dividends.ts`, `app/components/dividend-text.tsx`, `app/hooks/use-dividends.ts` | Dividend schedule (ADR 0022): `dividendInfo` (frequency from ex-date gaps, last payment, next announced or expected), shared wording (`DividendSummary`, `upcomingDividend`), `useDividends` for `/api/dividends` |
| `app/lib/performance.ts`, `app/hooks/use-performance.ts`, `app/.server/market/daily-closes.ts` | Portfolio performance vs SPY (ADR 0024): `performanceSeries` (daily value from trades × closes, cash in/out, the same flows in SPY), `timeWeightedReturn`, `rangeBaseDay`/`summarizeRange` (1M, 3M, YTD, 1Y, All); `useDailyCloses` for `/api/performance`; `hub.getDailyCloses` (stored `bars_1d` plus REST downloads of missing head/tail ranges for any symbol, remembered per process, plus today's latest price) |
| `app/lib/dividends-received.ts`, `app/lib/dividend-calendar.ts`, `app/hooks/use-dividends-received.ts`, `app/.server/market/dividend-history.ts` | Dividends received and calendar (ADR 0025): `receivedDividends` (paid payouts × shares each portfolio held before the ex-date, less withholding, or the owner's override), `receivedSummary`/`receivedByYear`; `dividendCalendar` (12 months from `dividendTally`); `useDividendsReceived` (withholding in `krestrel.dividendWithholding`, optimistic overrides); `hub.getDividendHistory` (payouts `[from, today]`, own 6 h cache) |
| `app/lib/currency.ts` | Display currency: `formatMoney`, `currencyName`, `/api/fx` schema |
| `app/.server/fx/` | `FxRateCache`: ECB daily USD rates via Frankfurter, 6 h cache, stale-on-failure (ADR 0013). `FxHistoryCache`: one daily-rate series per currency from a start date (10 lead days for weekends), 6 h refresh, refetch for an earlier start, stale-on-failure (ADR 0027) |
| `app/lib/fx-history.ts`, `app/lib/tax-report.ts`, `app/hooks/use-fx-history.ts` | Per-date conversion (ADR 0027): `/api/fx/history` schemas, `rateOnDay` (latest rate on or before a day, none when over `MAX_RATE_AGE_DAYS` old), `taxReport` (average-cost replay in USD and the display currency, per year, plus dividends received by pay date; items without a rate counted apart), `taxSellsCsv`; `useFxHistory` (no request for USD; reloads after 6 h or a new New York day) |
| `app/lib/analysis.ts` | Hindsight analysis: swing pivots, best round trips (DP), support/resistance, trend support |
| `app/lib/trade-plan.ts` | Rule-based forward plan from the analysis: bias, buy zone, stop, targets, reward:risk (ADR 0016) |
| `app/lib/outlook.ts` | AI outlook contract: `OutlookSchema` (model output), request/response schemas, text budgets (ADR 0016); model aliases live in `app/lib/ai.ts` |
| `app/lib/ideas.ts` | Stock ideas contract: GICS `SECTORS`, focuses, growth/dividend/risky categories, `IdeasModelSchema` (model output), request/response schemas, text budgets (ADR 0017) |
| `app/.server/llm/` | AI backends behind one `LlmClient` (ADR 0020): `claude-cli.ts` (the owner's Claude Code CLI, a client per model alias, one shared busy guard, web search and image input; every prompt passes `redactPii`, runs with `--safe-mode` in a scratch folder without the user name, ADR 0021), `ollama.ts` (loopback-only Ollama), `local-models.ts` (list and pull), `web-search.ts` (Tavily), `research.ts` (`gatherResearch`; `httpUrl`, the one canonical form of a link; `citationCheck`, the `(url) => boolean` the outlook and ideas sanitizers use to keep only links the answer may cite), `instance.ts` (`getAi(choice)`, `aiFailureResponse`) |
| `app/.server/analysis/outlook.ts` | Outlook prompt (levels, local plan, indicators, feed headlines, web-research task), `sanitizeOutlook` (budgets, http(s) links, price bands), `generateOutlook` |
| `app/.server/analysis/ideas.ts` | Ideas: starting mix (`openPositions` across portfolios, `holdingWeights` by value, cost basis when unpriced), prompt (symbols + percent weights only, focus, web-research task), `sanitizeIdeas` (valid unique tickers, not held, in focus, budgets, http(s) sources, ≤ 10), `generateIdeas` |
| `app/.server/startup.ts` | Boot: migrations → hub start → SIGTERM/SIGINT shutdown |
| `app/entry.server.tsx` | Calls `await startServer()` at module scope |
| `app/routes/api.*.ts` | `stream` (SSE), `bars.$symbol` (JSON), `outlook.$symbol` (AI outlook), `ideas` (AI stock ideas), `ai` (AI status, model downloads), `watchlist` and `portfolios` (actions), `portfolio-import` (screenshot → holdings via the chosen AI), `stock-profiles`, `signals`, `fx`, `health` |

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
| `alert` | `{ id, symbol, direction, price, triggerPrice, triggeredAt }` (`AlertFired`, ms epoch) | A live trade reached a price alert; once per alert (ADR 0023) |

Plus `: ping` every 15 s. Headers include `Cache-Control: no-cache, no-transform` so `react-router-serve`'s compression doesn't buffer. On hub shutdown every stream is closed.

## HTTP API

| Route | Method | Notes |
|---|---|---|
| `/api/bars/:symbol?tf=1m…4h\|1D\|1W\|2W\|1M\|1Y[&from&to]` | GET | Candles (`time` = epoch seconds). Intraday from `bars_1m`; calendar intervals from `bars_1d` + today's minutes (ADR 0011). Default look-back per interval (2 d … 30 y). 400 on bad input |
| `/api/assets?q=a[&limit=8]` | GET | Symbol search over the provider listing: exact ticker, ticker prefix (shortest first), then company-name words (≥ 2 chars). 502 with a plain message if the listing can't load |
| `/api/outlook/:symbol` | POST | `OutlookRequest` `{ timeframe, candles (20…6000, the Insights window), ai? }` (`ai` = `AiChoice`, default Claude) → `{ ok, provider, model, localPlan, outlook, feedHeadlines, research, researchNote, generatedAt }`. The server re-windows the candles (`analysisWindow`), runs `analyzeChart` + `buildTradePlan`, adds the hub's last 30 days of headlines, gathers research (`web` for Claude with only `WebSearch`/`WebFetch`, `tavily` for a local model with `TAVILY_API_KEY`, else `none`) and runs the chosen AI (5 min timeout); the answer is schema-validated then sanitised, and outside `web` mode links must come from the feed or Tavily (ADR 0016, 0020). Errors `{ ok:false, error:{code,message} }`: `invalid` 400, `not_enough_data` 422, `not_signed_in`/`not_installed`/`disabled`/`unavailable`/`model_missing`/`config` 503, `busy`/`rate_limited` 429, `timeout` 504, `invalid_output`/`failed` 502 |
| `/api/ideas` | POST | `IdeasRequest` `{ focus? (diversify \| GICS sector), ai? }` → `{ ok, provider, model, focus, basis, holdings, sectorWeights, summary, suggestedSectors, ideas, research, researchNote, generatedAt }`. Starting mix: open holdings across all portfolios weighted by value (basis `portfolio`), else the watchlist equally weighted (`watchlist`), else `none`; only symbols and percent weights go to the AI. Research as for `/api/outlook` (Tavily queries name the focus, never holdings); the answer is schema-validated and sanitised, then every ticker is checked against the provider listing (loaded in the background while the AI works; per-ticker lookups when it can't load): unlisted ones are dropped, ones that couldn't be checked are kept with an empty `exchange`, quoted without subscribing, and flagged `watched` (ADR 0017). Errors as `/api/outlook` plus `invalid_output` 502 when fewer than 3 listed ideas survive |
| `/api/watchlist` | GET | `{ symbols, provider }` |
| `/api/watchlist` | POST | JSON: `{intent:"add",symbol}` / `remove` / `reorder` (`symbols[]`). Typed errors: `invalid`/`unknown` 422, `duplicate` 422, `limit` 409, `upstream` 502, `stale` 409 |
| `/api/alerts` | GET | `{ok:true, alerts:[{id, symbol, direction, price, active, createdAt, triggeredAt, triggerPrice}]}`: active alerts plus those fired in the last 7 days, newest first (times ms epoch; ADR 0023) |
| `/api/alerts` | POST | JSON `{intent:"create", symbol, direction:"above"\|"below", price>0}` / `{intent:"delete", id}` → the updated list as for GET. Typed errors: `invalid` 400, `not_watched` 400 (alerts belong to watchlist symbols), `not_found` 404 |
| `/api/portfolios` | POST | JSON: `{intent:"create",name}` / `rename` (`id,name`) / `delete` (`id`) / `addTrade` (`portfolioId`, trade) / `updateTrade` (`id`, trade) / `deleteTrade` (`id`) / `importTrades` (`portfolioId`, `trades[≤100]`, all or nothing); trade = `{symbol, side, shares, price, fee, tradedOn}` in USD. Recording a trade adds the symbol to the watchlist once the trade is saved. Typed errors: `invalid` 400, `duplicate` 409, `oversell` 409, `unknown_symbol` 422, `not_found` 404; `{ok:true, warning}` when saved but unpriced |
| `/api/portfolio-import` | POST | multipart `image` (PNG/JPEG/WebP ≤ 20 MB, shrunk to ≤ 3.2 MP in the browser), `ai` (JSON `AiChoice`, default the local model) and `masked` (`1` after the page's on-device mask; required for Claude) → `{ok:true, holdings:[{symbol, shares\|null, averageCost\|null}], readBy, warning?}` (warning when costs aren't USD); saves nothing. Errors: `invalid` 400, `unmasked` 400 (Claude without the mask, ADR 0021), `too_large` 413, `unsupported` 415, `nothing_found` 422, AI errors as for `/api/outlook` (ADR 0018) |
| `/api/portfolio-targets?p=<id>` | GET | `{ok:true, portfolioId, targets:[{symbol, weight}]}` (percent, largest first; none = `[]`); 400 `invalid` without a portfolio id (ADR 0026) |
| `/api/portfolio-targets` | POST | JSON `{portfolioId, targets:[{symbol, weight 0.01–100}]}` replaces all of the portfolio's targets (one per symbol, total ≤ 100% + 0.01; `[]` clears) and returns them like GET. Errors: `invalid` 400, `not_found` 404 |
| `/api/stock-profiles` | POST | JSON `{intent:"classify", symbols[≤100], ai?}` (the chosen AI, default local, classifies tickers without a profile; returns all their profiles) or `{intent:"set", symbol, sector\|null, style\|null}` (owner correction). Returns `{ok:true, profiles:[{symbol, sector, style, source}]}`; AI errors as for `/api/outlook` (ADR 0019) |
| `/api/ai` | GET | `AiStatus`: `{ok:true, claude:{enabled}, local:{reachable, defaultModel, models:[{id, installed, size, vision, preset}]}, tavily:{configured}}` (ADR 0020) |
| `/api/ai` | POST | JSON `{intent:"pull", model}` → NDJSON stream of Ollama pull progress (`{status, completed?, total?}` … `{status:"success"}` or `{error}`); 503 `unavailable` when Ollama can't be reached |
| `/api/signals` | GET | `{series: {SYMBOL: {closes (≈1 year of daily closes, oldest first), lastTime}}}` for watchlist symbols; the browser computes daily RSI signals with live prices (ADR 0014) |
| `/api/fx` | GET | `{ok:true, fx:{rates (per 1 USD, incl. USD), date, source}}` or 502 `{ok:false,error}` |
| `/api/fx/history?quote=THB&from=YYYY-MM-DD` | GET | `{ok:true, quote, rates:{day: rate per 1 USD}}` for ECB business days from 10 days before `from` (weekends use the previous rate); 400 `{ok:false,error}` for a bad code, a code the ECB doesn't publish, a date before 1999 or in the future; 502 when unavailable. Only the code and date go upstream (ADR 0027) |
| `/api/dividends?symbols=A,B` | GET | 1–100 symbols → `{ok:true, today, dividends:{SYMBOL: {frequency, last:{exDate,payDate,amount}, next:{…, expected}\|null} \| null}}` from the provider's cash dividends via `hub.getDividends` (6 h cache); a symbol is missing when the provider couldn't be asked; 400 on bad symbols (ADR 0022) |
| `/api/dividends-received?symbols=A,B&portfolios=<id>,<id>&from=YYYY-MM-DD` | GET | 1–500 symbols, 1–100 portfolio ids, `from` ≤ today → `{ok:true, today, payouts:{SYMBOL: [{exDate, payDate, amount, special}]}, overrides:[{portfolioId, symbol, exDate, amount}]}`: cash payouts paid from `from` to today via `hub.getDividendHistory` (a symbol is missing when the provider couldn't be asked) and the owner's corrections; 400 `{ok:false,error}` on bad input (ADR 0025) |
| `/api/dividends-received` | POST | JSON `{intent:"set", portfolioId, symbol, exDate, amount (USD ≥ 0)}` or `{intent:"clear", portfolioId, symbol, exDate}` → `{ok:true}`; 400 `invalid`, 404 `not_found` (portfolio gone) (ADR 0025) |
| `/api/performance?symbols=A,SPY&from=YYYY-MM-DD` | GET | 1–100 symbols (`MAX_PERFORMANCE_SYMBOLS`), `HISTORY_START` (1990-01-01) ≤ `from` ≤ today → `{ok:true, today, closes:{SYMBOL: [[day, close], …]}, incomplete:[SYMBOL]}`: split-adjusted daily closes from `from`, oldest first, every symbol present (empty when unknown), the last entry possibly today's latest price; `incomplete` names symbols whose download failed; via `hub.getDailyCloses`, which downloads missing days over REST and stores them in `bars_1d`; 400 `{ok:false,error}` on bad input (ADR 0024) |
| `/api/health` | GET | 200/503 by DB; includes upstream status |
| `/ocr/:file` | GET | On-device OCR assets from `node_modules` (allow-list: `worker.min.js`, three `tesseract-core-*-lstm.wasm.js` builds, `eng.traineddata.gz`), so tesseract.js never uses a CDN; anything else 404 (ADR 0021) |

`/api/watchlist`, `/api/alerts`, `/api/portfolios`, `/api/portfolio-import`, `/api/portfolio-targets`, `/api/dividends-received`, `/api/stock-profiles`, `/api/outlook/:symbol`, `/api/ideas` and `/api/ai` (POST) refuse requests sent by pages from another origin (`crossSiteRejection` in `app/.server/same-origin.ts`: `Sec-Fetch-Site`, else `Origin` vs. host → 403 `cross_site`). Browsers send `text/plain` and multipart POSTs to 127.0.0.1 without a CORS preflight, so without this any website could run these actions. Clients without those headers (curl, tests) pass.

The root route's `middleware` (`requestGuard` in `app/.server/request-guard.ts`) runs for every request, resource routes included. A Host header that isn't `127.0.0.1`, `localhost` or `[::1]` gets 421, which blocks DNS rebinding (Vite dev already checks Host; `react-router-serve` doesn't). Any cross-site `/api/*` request gets 403 `cross_site` for every method, because some GETs have side effects (`/api/performance` stores bars; dividends and FX history call upstream). Document navigations from other sites stay allowed. Documents also send `X-Frame-Options: DENY` and `Content-Security-Policy: frame-ancestors 'none'` (set in `app/entry.server.tsx`) so no page can frame Krestrel.

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
