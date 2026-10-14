# `ai/`: working guidelines for Krestrel

Repo-specific guidance for anyone (human or agent) changing this code. `CLAUDE.md` is the entry point; these files hold the detail.

| File | Read it when |
|---|---|
| `architecture.md` | Touching data flow, the MarketHub, SSE, startup, reconnects, failure handling |
| `react-router.md` | Adding or changing routes, loaders/actions, resource routes, server-only modules |
| `market-data.md` | Anything that talks to Alpaca, or adding a provider (Finnhub) |
| `database.md` | Schema, migrations, queries, bucketing, backfill |
| `conventions.md` | Naming, file layout, TypeScript rules, errors, logging, comments |
| `ui.md` | Components, design tokens, states, accessibility, copy |
| `testing.md` | Writing or running tests, fixtures, the mock provider |
| `workflows.md` | Step-by-step recipes for common changes |
| `decisions/` | ADRs: why things are the way they are. Add one for any decision a future reader would question |

## Rules

- **Update docs in the same commit as the code they describe.** A stale guideline is worse than none.
- Docs state verified, current APIs only. Cite the source (Context7 library ID or official URL) when a fact is non-obvious.
- Keep each file short and specific to this repo. No generic advice.
- Sections marked *Status: planned (Phase N)* describe agreed design that has no code yet; replace them with the real details when that phase lands.
