# Testing

## Suites

| Suite | Runner | Location | Environment | Command |
|---|---|---|---|---|
| Unit | Vitest 5 project `unit` | `app/**/*.test.ts`, `tests/unit/**/*.test.ts` | node | `bun run test` |
| Component | Vitest 5 project `dom` | `app/**/*.test.tsx`, `tests/unit/**/*.test.tsx` | jsdom 30 | `bun run test` |
| DB + hub | Vitest project `db` | `app/.server/market/db/**/*.test.ts`, `app/.server/market/hub.test.ts` | real Postgres (`<db>_test`), files sequential | `bun run test` (needs `bun run db:up`) |
| E2E (Phase 5) | Playwright | `tests/e2e/` | Chromium, `MARKET_PROVIDER=mock` | `bun run test:e2e` |

Run one project: `bun run vitest run --project unit`. Watch: `bun run vitest`.

## Config notes (Vitest 5)

- `vitest.config.ts` is separate from `vite.config.ts` so the `reactRouter()` plugin never loads in tests.
- Inline projects **inherit** the root config (Vitest 5 default `extends: true`); arrays such as `setupFiles` are appended. Keep DOM-only setup inside the `dom` project.
- `globals: false`, so `tests/setup-dom.ts` registers `afterEach(cleanup)` and `@testing-library/jest-dom/vitest` matchers.
- Vitest 5: `clearMocks` is on by default; `vi.mock`/`vi.hoisted` must be top-level.
- JSX in tests is transformed by Vite 8's built-in Oxc (no React plugin needed).

## What to test where

- Alpaca parsing/normalization: recorded fixtures in `tests/fixtures/alpaca/` (scrubbed: no keys, no account IDs).
- Alert engine: crossing logic, fire once, no double-fire across reconnect.
- Bar upsert idempotency, timeframe bucketing: against real Postgres.
- Env validation, watchlist 30-symbol limit.
- Components: watchlist row rendering, price formatting.
- Route modules typed with `Route.*`: E2E, not unit (React Router docs).

## Rules

- Tests assert behaviour a user or caller would notice: boundaries, transitions, errors. No tests of wiring or copied constants.
- Never hit Alpaca from tests. Use fixtures or `MockProvider`.
- No secrets in tests or fixtures.
- Deterministic: fake timers for backoff/heartbeat, seeded randomness in `MockProvider`.

## Postgres test DB

`tests/db/global-setup.ts` creates `<DATABASE_URL db>_test` (or uses `TEST_DATABASE_URL`) and migrates it; `setupTestDatabase()` from `tests/db/test-db.ts` truncates all tables before each test. Add a file to the `DB_TESTS` list in `vitest.config.ts` if it needs the database outside `app/.server/market/db/`.

## Provider tests

Providers take injectable deps (`openSocket`/`fetch`/`now`/`random`/`sleep` for Alpaca; `now`/`random`/`tickIntervalMs` for mock) and a silent pino logger. Hub tests use a fake `MarketDataProvider` object — the contract boundary — against the real test DB.

## CI (Phase 5)

GitHub Actions on push/PR: `bun install --frozen-lockfile`, `bun run typecheck`, `bun run lint`, `bun run test`, with a `postgres:18-alpine` service container.
