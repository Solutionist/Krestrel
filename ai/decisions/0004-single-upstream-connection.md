# 0004: Exactly one upstream connection, owned by MarketHub

- Status: accepted (implemented in Phase 2)
- Date: 2026-10-14

## Context

Alpaca's free (Basic) plan allows one concurrent market-data stream. A second connection is rejected with error `406 connection limit exceeded` (docs.alpaca.markets/docs/streaming-market-data). Vite HMR re-evaluates server modules on change, so a naive module-level singleton would open a new socket on every edit. Bars must be recorded and alerts evaluated even with no browser tab open.

React Router 8 documents no server-startup hook for `react-router-serve` or the Vite dev server (checked: entry.server, server modules, instrumentation, adapter docs). `entry.server.tsx` (created with `react-router reveal`) is evaluated when the server build loads, before the first request.

## Decision

- `app/.server/market/instance.ts` exports `getMarketHub()`. The hub instance is stored on `globalThis` under a namespaced key, so module re-evaluation during HMR reuses the existing hub and its socket.
- The hub is started idempotently from `app/entry.server.tsx` module scope. `getMarketHub()` also starts it lazily as a fallback.
- Nothing else may construct a provider or open a socket. Routes, the bar writer, and the alert engine subscribe to hub events.
- The dev server uses `strictPort` and `bun run start` sets a fixed `HOST=127.0.0.1 PORT=3000`, so an accidental second server process fails fast instead of opening a second upstream connection on another port.

## Consequences

- HMR-safe: logs show one `connected` per process lifetime (proved in Phase 2 acceptance).
- Running `bun run dev` and `bun run start` at the same time *will* trip 406. The hub surfaces that as a `status` event with a plain-language message and backs off instead of retrying rapidly (see failure modes in `ai/architecture.md`).
- Changes to the hub's own module may require a manual restart to pick up; documented in `ai/workflows.md`.
