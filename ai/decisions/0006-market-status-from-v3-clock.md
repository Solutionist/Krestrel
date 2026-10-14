# 0006: Market status from `/v3/clock`, not `/v2/clock`

- Status: proposed (implemented in Phase 2; verify against a live response first)
- Date: 2026-10-14

## Context

The product needs four states: open, closed, pre-market, after-hours. Alpaca's `GET /v2/clock` returns only `is_open` (core session), `next_open`, `next_close`, so it cannot distinguish pre-market or after-hours from closed. The Trading API also documents `GET /v3/clock?markets=NYSE`, returning per-market `phase` ∈ `closed | pre | core | lunch | post` and `phase_until` (docs.alpaca.markets/us/reference/clock-1). It is not marked beta.

## Decision

- Use `GET {tradingBase}/v3/clock?markets=NYSE`, map `pre → pre-market`, `core → open`, `post → after-hours`, `closed → closed`. `lunch` does not occur for NYSE; treat it as `open` and log a warning if seen.
- Re-poll at `phase_until` (plus a small jitter) instead of on a fixed interval.
- `tradingBase` is the paper host `https://paper-api.alpaca.markets` by default (free Basic plan keys are usually paper keys); configurable.
- Fallback if `/v3/clock` fails validation: `/v2/clock` for open/closed plus `/v2/calendar` `session_open`/`session_close` (HHMM, ET) to derive pre/post.

## Consequences

- One request per phase change (~4/day) instead of polling.
- The prompt's "Alpaca clock endpoint" is honoured, using the newer version that carries the needed information. Logged as a docs-vs-prompt discrepancy in the Phase 0 report.
