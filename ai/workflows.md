# Workflows

Every recipe ends with `bun run typecheck && bun run lint && bun run test` and updating the matching `ai/` doc in the same commit.

## Add a route

1. Add an entry to `app/routes.ts` (`route("path", "routes/file.tsx")`).
2. Create the module; import types from `./+types/<file>`.
3. Run `bun run typecheck` to generate types.
4. Resource route (JSON/SSE)? No default export; return a `Response`.
5. Server logic goes in `app/.server/`; validate action input with Zod and return typed errors.

## Add a DB column

1. Edit `app/.server/market/db/schema.ts`.
2. `bun run db:generate` → review the SQL in `drizzle/`.
3. `bun run db:migrate`.
4. Update query functions and their tests.
5. Commit schema + migration together. Never `push` on real data.

## Add a provider (e.g. Finnhub)

Follow the checklist at the end of `ai/market-data.md`. The hub, bar writer, alert engine, and UI must not change except for the data label.

## Add an SSE event type

1. Add a Zod schema + type in `app/lib/` (shared by server and client).
2. Emit it from the hub fan-out in `api.stream.ts`.
3. Handle it in `useMarketStream`.
4. Add the event to the contract table in `ai/architecture.md`.

## Upgrade a dependency safely

1. `bun info <pkg> dist-tags` — only `latest` (no beta/rc/canary/next/experimental).
2. Read the changelog/migration guide between current and target; check Context7 for the new version's API.
3. Bump the exact pin in `package.json`, `bun install`.
4. Run the full check plus `bun run build`, and smoke `bun run dev`.
5. Update the version table in `ai/decisions/0001-stack.md` and any affected `ai/` doc.

## Bump Node LTS

Update `.nvmrc`, `engines.node` and `@types/node` together; check `engines` of jsdom/vitest/react-router.

## Restart after editing the market hub

The hub lives on `globalThis` to survive HMR (ADR 0004), so edits to `hub.ts` or the provider may not take effect until you stop and restart `bun run dev`.
