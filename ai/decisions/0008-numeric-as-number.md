# 0008: `numeric` columns map to JS `number`

- Status: accepted (Phase 1)
- Date: 2026-10-14

## Context

Prices are stored as `numeric(14,4)`. Drizzle 0.45 maps `numeric` to `string` by default; `mode: "number"` and `mode: "bigint"` exist. postgres.js returns `numeric` and `int8` as strings for raw queries.

## Decision

- Prices: `numeric({ precision: 14, scale: 4, mode: "number" })`.
- Volume: `bigint({ mode: "number" })` (daily volumes are far below 2^53).
- Raw SQL results (`db.execute`) are converted with `Number()` at the query-module boundary (`getCandles`).

## Consequences

- One numeric type end to end (DB → hub → SSE → chart) with no parsing in UI code.
- A double holds every 4-decimal value below ~10^11 to within half a ten-thousandth, so values round-trip exactly at 4 dp (verified by `alerts.test.ts`: 187.1234 in, 187.1234 out).
- Alert comparisons use JS numbers. Thresholds and trade prices both come from the same 4-dp domain, so float noise cannot flip a comparison at the 4th decimal.
- If a future feature needs exact decimal arithmetic (P&L sums), use `mode: "string"` plus a decimal library for that column only.
