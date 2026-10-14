# Conventions

## Files and naming

- Files: `kebab-case.ts`; React components `PascalCase` exports in `kebab-case.tsx` files. Route modules follow the route path (`api.bars.$symbol.ts`).
- Tests sit next to the code: `foo.ts` → `foo.test.ts` (node), `foo.tsx` → `foo.test.tsx` (jsdom).
- `app/lib/`: isomorphic only (no Node APIs, no secrets). `app/.server/`: server only. `app/components/`: presentational, no data fetching.
- Import alias `~/*` → `app/*`. Use relative imports within a feature folder.

## TypeScript (TS 7, `strict`)

- Extra checks on: `noUncheckedIndexedAccess`, `noImplicitOverride`, `noImplicitReturns`, `noFallthroughCasesInSwitch`, `verbatimModuleSyntax` (use `import type`).
- No `any` (Biome `noExplicitAny` = error). Parse unknown data with Zod instead of casting.
- No non-null `!` (Biome `noNonNullAssertion` = error). If unavoidable: `// biome-ignore lint/style/noNonNullAssertion: <why it cannot be null>`.
- Any disabled lint rule needs a `biome-ignore` comment with a reason.
- Types: `z.infer<typeof Schema>` for anything validated; hand-written types only for internal shapes.

## Errors

- **Expected failures return typed results**: actions return `{ ok: false, error: { code, message } }` (discriminated union) so the UI can render them. Examples: symbol limit reached, unknown symbol, validation errors.
- **Unexpected failures throw**: programmer errors, broken invariants, DB down. Route `ErrorBoundary` renders them.
- Upstream errors become `ConnectionStatus` values, never thrown into request handlers.
- Error messages shown to users: plain, active voice, say what to do next. Never include secrets or raw upstream payloads.

## Logging (pino 10)

- One root logger in `app/.server/logger.ts`; modules use `logger.child({ mod: "alpaca-ws" })`.
- Levels: `error` needs attention (auth failed, 406, DB down) · `warn` degraded but recovering (reconnect, schema mismatch on one message) · `info` lifecycle (connected, subscribed, backfill done) · `debug` per-message detail · `trace` raw frames (never in prod).
- Pass errors as `{ err }` (std serializer).
- Redact: `ALPACA_SECRET_KEY`, `ALPACA_KEY_ID`, `*.secret`, `*.key`, auth headers (`headers["apca-api-key-id"]`, `headers["apca-api-secret-key"]`). Never log the auth message or full env.
- Dev: `pino-pretty` transport. Prod: JSON to stdout (no transport).

## Formatting and imports

- Biome formats everything (`bun run format`): 2-space indent, width 100, double quotes.
- Import order is enforced by Biome's `organizeImports` assist; don't hand-sort.

## Comments

- Explain *why* (licence constraint, upstream quirk, invariant), not *what*.
- Link the doc or ADR when a line exists because of an external rule (e.g. `// ADR 0004`).
- No commented-out code, no TODOs without an owner phase.
