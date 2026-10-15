# 0001: Stack and verified versions

- Status: accepted
- Date: 2026-10-14

## Context

Krestrel must use the latest stable release of every dependency (no beta/rc/canary/next/experimental tags, no `unstable_*` APIs). Versions were resolved on 2026-10-14 with `npm view <pkg> dist-tags`, nodejs.org `dist/index.json` plus the Node release schedule, postgresql.org/support/versioning, and Docker Hub tags.

## Decision

### Runtime and services

| Item | Version | Evidence |
|---|---|---|
| Node.js | **24.x LTS "Krypton"** (24.21.0 verified); `.nvmrc` = `24`, `engines.node` = `^24.15.0` | Only Active LTS line on 2026-10-14 (v24 Active until 2026-10-20). v26 enters LTS on 2026-10-28. `^24.15.0` is jsdom 30's floor |
| Bun | 1.4.3 (package manager + script runner only; app runs on Node), pinned via `packageManager`; lockfile `bun.lock` | `latest` tag; chosen by owner over pnpm (2026-10-14) |
| PostgreSQL | **18** (18.6 current), image `postgres:18-alpine` | 19 is at `19beta4` on Docker Hub and postgresql.org; no GA, no RC |
| App image | `node:24-alpine` runtime, `oven/bun:1.4.3-alpine` binary for install/build (`Dockerfile`, multi-stage) | Local Docker use only, never published |

### npm packages (exact pins; lockfile committed)

| Package | Version | Role |
|---|---|---|
| react-router, @react-router/node, @react-router/serve, @react-router/dev | 8.4.0 | Framework mode |
| react, react-dom | 19.3.0 | UI |
| @types/react, @types/react-dom | 19.3.0 | Types |
| isbot | 5.2.2 | Template dependency (bot detection in default server entry) |
| vite | 8.3.4 | Bundler (Rolldown) |
| typescript | 7.0.2 | Native compiler; `@react-router/dev` 8.3+ allows `^7.0.0` |
| tailwindcss, @tailwindcss/vite | 4.3.3 | CSS-first config |
| @biomejs/biome | 2.5.15 | Lint + format |
| vitest | 5.0.4 | Unit/component tests |
| @testing-library/react | 16.3.3 | Component tests |
| @testing-library/dom | 10.4.2 | RTL peer, installed explicitly |
| @testing-library/jest-dom | 7.0.1 | DOM matchers |
| jsdom | 30.1.2 | DOM environment for component tests |
| @types/node | 24.19.2 | Matches Node 24 |
| drizzle-orm | 0.45.4 | ORM (1.0 exists only as beta/rc tags) |
| drizzle-kit | 0.31.11 | Migrations (dev) |
| postgres | 3.4.9 | DB driver |
| zod | 4.6.7 | Validation |
| pino | 10.4.0 | Logging |
| pino-pretty | 13.2.0 | Dev log formatting (dev only) |
| lightweight-charts | 5.2.1 | TradingView chart (ADR 0010) |
| @fontsource/ibm-plex-sans, @fontsource/ibm-plex-mono | 5.3.0 | Self-hosted UI fonts |
| tesseract.js | 7.0.0 | On-device OCR that masks screenshots before Claude sees them (ADR 0021) |
| @tesseract.js-data/eng | 1.0.0 | English OCR model, served locally from `/ocr/*` (ADR 0021) |

Resolved now, installed in the phase that first needs them:

| Package | Version | Phase |
|---|---|---|
| @playwright/test | 1.64.0 | 5 |

## Consequences

- TypeScript 7 removed `baseUrl`, `esModuleInterop: false`, `moduleResolution: node10`, `downlevelIteration`, and `target: ES5`. The tsconfig uses none of them. `types` must be listed explicitly (`["node", "vite/client"]`).
- React Router 8 is ESM-only, needs Node ≥ 22.22, React ≥ 19.2.7, Vite ≥ 7, and always enables middleware (`context` is a `RouterContextProvider`).
- Bun replaces pnpm: `bun install`, `bun run <script>`, `bunx <bin>`. Bare `bun test` runs Bun's own runner, not Vitest — always `bun run test`. Package bins still execute on Node (no `--bun`), so runtime behaviour matches production.
- Re-check Node in late October 2026: when v26 becomes Active LTS, bump `.nvmrc`, `engines`, `@types/node`, and CI together (see `ai/workflows.md`).
- Upgrades follow the dependency recipe in `ai/workflows.md`. Update this table in the same commit.
