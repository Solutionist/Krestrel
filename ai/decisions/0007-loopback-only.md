# 0007: Loopback-only servers

- Status: accepted
- Date: 2026-10-14

## Context

Alpaca market data is licensed for personal, non-professional use; redistribution is not allowed. Vite's dev server defaults to `localhost`, but `react-router-serve` listens on **all interfaces** unless `HOST` is set (`@react-router/serve` `cli.js`: `process.env.HOST ? app.listen(port, HOST) : app.listen(port)`). Postgres in Docker publishes on `0.0.0.0` unless the port binding names an address.

## Decision

- `vite.config.ts`: `server.host = "127.0.0.1"`, `server.strictPort = true`.
- `bun run start`: `HOST=${HOST:-127.0.0.1} react-router-serve …` (default-value expansion; verified under Bun's script runner).
- `docker-compose.yml`: every published port is `127.0.0.1:<host>:<container>` (`db` 5432, `app` 3000). Inside the app container `HOST=0.0.0.0` is required for Docker port forwarding; the loopback-only port binding is what limits exposure.
- Request guard: root route middleware (`app/.server/request-guard.ts`) answers 421 to any Host other than `127.0.0.1`, `localhost` or `[::1]` (DNS rebinding) and 403 to cross-site `/api/*` requests of any method.

## Consequences

- Nothing is reachable from the LAN by default. Overriding `HOST` is an explicit, visible act.
- With `HOST=0.0.0.0`, requests that reach the server through a LAN hostname or IP get 421 by design.
