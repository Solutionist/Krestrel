# 0002: Server-Sent Events, not browser WebSockets

- Status: accepted (implemented in Phase 2)
- Date: 2026-10-14

## Context

Market data flows one way: Alpaca → server → browser. The browser never streams anything back; it changes state (watchlist, alerts) through ordinary route actions. React Router framework mode has no WebSocket server integration, but resource routes can return any `Response`, including a streaming body.

## Decision

Push live data to the browser over SSE from a resource route (`app/routes/api.stream.ts`) whose `loader` returns `new Response(readableStream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } })`. The browser consumes it with `EventSource`.

- Event types: `tick`, `bar`, `status`, `alert`. Payloads are JSON matching the Zod schemas in `app/lib/` (contract in `ai/architecture.md`).
- A comment line (`: ping`) every 15 s keeps proxies and the browser from timing out an idle stream.
- Listeners are removed when `request.signal` aborts.

## Consequences

- No extra server, port, or upgrade handling; works with the stock `react-router-serve` and the Vite dev server.
- `EventSource` reconnects automatically. The server re-sends current state on connect, so a reconnecting tab is consistent.
- One HTTP connection per open tab. Single user, so the browser's 6-connections-per-origin HTTP/1.1 limit only matters with many tabs open.
- Upstream (Alpaca) still uses a WebSocket, server-side only. See ADR 0004.
