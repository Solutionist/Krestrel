# Database

Status: implemented in Phase 1 (`app/.server/market/db/`, migration `drizzle/0000_init.sql`). Sources: Drizzle docs (Context7 `/drizzle-team/drizzle-orm-docs`), published package typings, PostgreSQL 18 docs, Docker Hub `postgres` README.

## Version and Docker

- `postgres:18-alpine` (19 is beta). Pin the major, never `latest`.
- **PG 18 image change:** volume mount point is `/var/lib/postgresql` (not `…/data`); `PGDATA` is `/var/lib/postgresql/18/docker`. Mounting the old path silently writes to an anonymous volume.
- `POSTGRES_USER/PASSWORD/DB` only apply on an empty data dir. Healthcheck: `pg_isready -U $${POSTGRES_USER} -d $${POSTGRES_DB}`.
- Port binding `127.0.0.1:5432:5432` (ADR 0007).

## Schema (`app/.server/market/db/schema.ts`)

`watchlist(symbol pk, position, added_at)`, `bars_1m(symbol, source, ts, open, high, low, close, volume, trade_count, vwap; pk (symbol, source, ts))`, `alerts(id uuid default uuidv7(), symbol → watchlist ON DELETE CASCADE, direction check above|below, price, active, created_at, triggered_at, trigger_price)` + partial index `alerts(symbol) WHERE active`, `portfolios(id uuidv7, name unique, created_at)`, `trades(id uuidv7, portfolio_id → portfolios ON DELETE CASCADE, symbol, side check buy|sell, shares numeric(18,6) > 0, price ≥ 0, fee ≥ 0 default 0, traded_on date, created_at)` + index `(portfolio_id, symbol)` (ADR 0013). `source` is free-form text owned by providers (ADR 0009).

Drizzle syntax notes (0.45.4):

- Third `pgTable` arg returns an **array**: `(t) => [primaryKey({ columns: [t.symbol, t.source, t.ts] }), …]`.
- `index("alerts_active_symbol_idx").on(t.symbol).where(sql\`${t.active}\`)`; `check("name", sql\`…\`)` (name required).
- `uuid().default(sql\`uuidv7()\`)` (built into PG 18; `defaultRandom()` would be v4).
- `bigint()` **requires** `{ mode }`.
- `timestamp({ withTimezone: true, mode: "date" })`.

## Daily history (ADR 0011)

`bars_1d(symbol, source, day date, open, high, low, close, volume)`, PK `(symbol, source, day)`, split-adjusted, `day` = New York trading date (migration `0001_daily_bars`). Queries: `upsertDailyBars`, `getCalendarCandles` (daily rows + minute-built days after the newest daily row, rolled up by `aggregateDays` from `app/lib/candles.ts`), `dailyBounds` (first/last stored day per symbol) and `listDailyCloses` (closes for many symbols over `[from, to)`), the last two for portfolio performance (ADR 0024), which also stores daily history for held stocks that aren't on the watchlist. Intraday `getCandles` buckets 1m/5m/15m/30m/1h/4h with `date_bin`.

## Numeric mapping (ADR 0008)

Prices `numeric({ precision: 14, scale: 4, mode: "number" })`, volume `bigint({ mode: "number" })`. Raw `db.execute` results are converted with `Number()` inside the query module.

## Migrations

- `bun run db:generate` (drizzle-kit generate) → review SQL in `drizzle/` → `bun run db:migrate`. Commit migrations.
- The server also applies committed migrations on boot (`runMigrations` in `app/.server/startup.ts`); the Docker image copies `drizzle/`.
- `push` only against a throwaway database.
- drizzle-kit loads `.env` itself; the app loads it with `process.loadEnvFile()` in `env.ts` (existing variables win).

## Modules and conventions

- `client.ts`: pure `createDatabase(url, options)` (no env access; used by tests). `instance.ts`: the app pool, cached on `globalThis` for HMR. Route/hub code imports `db` from `instance.ts`.
- All SQL in `app/.server/market/db/queries/{bars,watchlist,alerts,portfolios}.ts`. Every query function takes `db` as its first argument.
- `watchlist.ts`: `addToWatchlist(db, symbol, maxSymbols)` returns a typed result (`duplicate` | `limit`); add/reorder are serialized with `pg_advisory_xact_lock`. `reorderWatchlist` only accepts an exact permutation.
- `bars.ts`: `upsertBars` (chunks of 1000 rows, de-duplicates repeated keys in one call, last wins), `latestBarTime`, `getCandles`.
- `portfolios.ts`: portfolio names are unique ignoring case (checked under an advisory lock). `addTrade`/`updateTrade`/`deleteTrade` replay the portfolio's trades with the change applied (`computePositions`) under a per-portfolio advisory lock and return `oversell` instead of writing when a sell would exceed the shares held on its date.
- `alerts.ts`: `markAlertTriggered` is a conditional `UPDATE … WHERE active RETURNING`, the fire-once guarantee. `createAlert` returns `null` when the symbol isn't on the watchlist (foreign-key violation, code 23503); `listRecentAlerts(db, since)` returns active alerts plus those fired since then (ADR 0023).
- `portfolio-targets.ts`: `listTargets` (largest first) and `replaceTargets`, which locks the portfolio row (`SELECT … FOR UPDATE`) and swaps the whole set in one transaction; false when the portfolio is gone (ADR 0026).
- `dividend-overrides.ts`: `listDividendOverrides(db, portfolioIds)`, `setDividendOverride` (upsert on portfolio + symbol + ex-date after `SELECT … FOR SHARE` on the portfolio row; false when the portfolio is gone) and `clearDividendOverride` (ADR 0025).
- Raw SQL params: pass timestamps as ISO strings with `::timestamptz` (Drizzle replaces postgres.js timestamp serializers).
- `db.execute(sql\`…\`)` with postgres-js returns a row **array**. Close with `await db.$client.end()`.

## Test database

`db` Vitest project: `tests/db/global-setup.ts` creates `<DATABASE_URL db>_test` (or uses `TEST_DATABASE_URL`) on the dev Postgres and migrates it; `setupTestDatabase()` truncates all tables before each test. Files run sequentially. Requires `bun run db:up`.

## Timeframe bucketing

- 5m/15m/1h: `date_bin(interval '5 minutes', ts, timestamptz '2000-01-03 00:00:00+00')`. Stride must be < 1 month. With a UTC-midnight origin, buckets land on clock :00/:15/:30/:45 in ET too (ET offsets are whole hours), so the 09:30 open falls mid-hour for 1h bars. Open question for Phase 1: session-aligned hourly bars (09:30, 10:30, …) would need a DST-aware origin per day.
- 1D: `date_trunc('day', ts, 'America/New_York')` (DST-correct). `(ts AT TIME ZONE 'America/New_York')::date` for a date label.
- OHLC per bucket: `first`/`last` via `array_agg(open ORDER BY ts)[1]` / `array_agg(close ORDER BY ts DESC)[1]`, `max(high)`, `min(low)`, `sum(volume)`.

## Backfill and upsert rules

SIP REST, `feed=sip`, `end = now − 16 min`, default lookback `BACKFILL_DAYS=30`, paginate `next_page_token`, respect 200 req/min. All writes are upserts, so repeats are safe.

Daily history (`bars_1d`) fills the tail after the newest stored day and, once per process per symbol, the head back to `DAILY_HISTORY_YEARS` before the oldest stored day. A head download is held in memory and upserted only once complete, so a partial head never moves the oldest day. Shutdown stops a download after its current page.
