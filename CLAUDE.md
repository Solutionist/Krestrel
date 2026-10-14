# Krestrel

Personal, self-hosted, real-time NYSE/Nasdaq ticker. Single user, runs locally. Not a trading app.

## Stack
React Router 8 (framework mode) · React 19.3 · TypeScript 7 strict · Tailwind CSS 4 · Vite 8 ·
Lightweight Charts 5 · Drizzle ORM + postgres.js · PostgreSQL 18 (Docker) · Zod 4 · pino 10 ·
Vitest 5 · Playwright · Biome 2 · Bun (package manager only) · Node 24 LTS. Exact versions: `ai/decisions/0001-stack.md`.

## Commands
- Toolchain: Node 24 (`.nvmrc`) runs the app; Bun installs packages and runs scripts (`bun install`, `bun run <script>`, `bunx <bin>`). Never use npm/pnpm/yarn.
- Always `bun run test`, never bare `bun test` (that is Bun's own test runner, not Vitest).
- `bun run dev`: dev server on http://127.0.0.1:5173 (loopback only, `strictPort`)
- `bun run build` / `bun run start`: production build / serve (`HOST` defaults to 127.0.0.1)
- `bun run typecheck` (typegen + tsc) · `bun run lint` (biome check) · `bun run format` (biome check --write) · `bun run test` (vitest run)
- Env: `cp .env.example .env`, fill `ALPACA_KEY_ID`/`ALPACA_SECRET_KEY` (or `MARKET_PROVIDER=mock`)
- `bun run db:up` / `bun run db:down`: start/stop Postgres only (Docker, 127.0.0.1:5432)
- Full stack in Docker: `docker compose up -d --build --wait` → http://127.0.0.1:3000
- `bun run db:generate` / `db:migrate` / `db:studio` (drizzle-kit; the server also auto-applies migrations on boot). `bun run test:e2e` arrives in Phase 5
- Offline dev without Alpaca keys: `MARKET_PROVIDER=mock` in `.env`
- Schema changes: `bun run db:generate` then `bun run db:migrate` (never `push` on real data)

## Map
- `app/routes.ts`: route config. `app/routes/`: route modules; `api.*` are resource routes (SSE, JSON)
- `app/.server/`: server-only (env, logger, db, market data). Never import from client code
- `app/.server/market/`: provider interface, Alpaca provider, MarketHub singleton, alert engine, bar writer
- `app/lib/`: isomorphic types, Zod schemas, formatters
- `tests/`: setup, fixtures (`tests/fixtures/alpaca/`), e2e. Unit tests sit next to code as `*.test.ts(x)`
- `ai/`: detailed guidelines and ADRs (see below)

## Always
- Look up current docs with Context7 before using any library API. Don't code from memory.
- Import from `react-router` / `react-router/dom`. Never `react-router-dom` (removed in v8).
- Use generated route types (`./+types/<route>`); run `bun run typecheck` to regenerate.
- Access market data only through `getMarketHub()`. Never open another upstream connection (free plan allows one; a second gets error 406).
- Validate every external input with Zod: env, actions, upstream messages.
- Keep secrets in `.server/` and `.env` only. Never log them or send them to the client.
- DB access only via `app/.server/market/db/queries/`. Timestamps UTC `timestamptz`.
- Use tabular numerals for prices; never use colour alone for up/down (pair with ▲/▼).
- Update the matching `ai/` doc in the same change as the code.
- Before finishing: `bun run typecheck && bun run lint && bun run test`.

## Never
- Add trading, auth, multi-user, public hosting, or data sharing (personal data licence). Sole exception: user-clicked "Ask Claude" (ADR 0012). Fetching exchange rates (currency codes only, ADR 0013) shares no data; portfolios record trades but never place orders.
- Touch Claude credentials: AI analysis only runs the user's own `claude` CLI (`app/.server/llm/`).
- Bind servers to anything but loopback.
- Use beta/rc/canary packages or `unstable_*` APIs.
- Import `lightweight-charts` in server code; create charts only inside effects.
- Use `any`, or `!` without a `biome-ignore` comment explaining why.

## Read when relevant
- Architecture & data flow → `ai/architecture.md`
- React Router patterns → `ai/react-router.md`
- Alpaca, IEX vs SIP, limits, adding providers → `ai/market-data.md`
- Schema, migrations, queries → `ai/database.md`
- Naming, errors, logging → `ai/conventions.md`
- UI tokens & rules → `ai/ui.md`
- Testing → `ai/testing.md`
- Step-by-step recipes → `ai/workflows.md`
- Decisions → `ai/decisions/` (0011: daily history + chart intervals)
