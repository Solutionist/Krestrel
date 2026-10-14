# 0003: PostgreSQL, not MongoDB

- Status: accepted
- Date: 2026-10-14

## Context

The data is relational and time-series shaped: a small watchlist, alerts that reference it, and many 1-minute OHLCV bars keyed by `(symbol, source, ts)`. Higher timeframes (5m, 15m, 1h, 1D) are derived on read.

## Decision

Use PostgreSQL 18 in Docker Compose, accessed through Drizzle ORM with the postgres.js driver.

## Consequences

- Composite primary keys and `INSERT … ON CONFLICT DO UPDATE` make bar writes idempotent (backfill and live stream can overlap safely).
- Timeframe aggregation happens in SQL: `date_bin()` for 5m/15m/1h and `date_trunc('day', ts, 'America/New_York')` for exchange days. No stored rollups of our own minutes; provider daily history is stored separately (ADR 0011).
- Foreign keys (`alerts.symbol → watchlist.symbol ON DELETE CASCADE`) and `CHECK` constraints enforce invariants in the database, not only in code.
- `numeric(14,4)` stores prices exactly. Drizzle and postgres.js return `numeric` as strings unless a mode is chosen; Krestrel maps it to `number` (ADR 0008).
- PG 18's built-in `uuidv7()` gives time-ordered alert IDs without an extension.
- Requires Docker locally. Acceptable for a single-user, self-hosted tool.
