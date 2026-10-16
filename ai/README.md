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

## Decisions

| ADR | Title | Status |
|---|---|---|
| [0001](decisions/0001-stack.md) | Stack and verified versions | accepted |
| [0002](decisions/0002-sse-over-websockets.md) | Server-Sent Events, not browser WebSockets | accepted |
| [0003](decisions/0003-postgres-over-mongodb.md) | PostgreSQL, not MongoDB | accepted |
| [0004](decisions/0004-single-upstream-connection.md) | Exactly one upstream connection, owned by MarketHub | accepted |
| [0005](decisions/0005-bars-by-source.md) | Store bars per source | accepted |
| [0006](decisions/0006-market-status-from-v3-clock.md) | Market status from `/v3/clock`, not `/v2/clock` | accepted |
| [0007](decisions/0007-loopback-only.md) | Loopback-only servers | accepted |
| [0008](decisions/0008-numeric-as-number.md) | `numeric` columns map to JS `number` | accepted |
| [0009](decisions/0009-pluggable-market-data-providers.md) | Pluggable market-data providers | accepted |
| [0010](decisions/0010-dark-theme-and-tradingview-lightweight-charts.md) | Dark theme only; TradingView Lightweight Charts | accepted |
| [0011](decisions/0011-daily-history-for-long-intervals.md) | Daily history table for 1D…1Y intervals | accepted |
| [0012](decisions/0012-ai-chart-analysis.md) | Hindsight chart analysis, explained by Claude via the user's subscription | accepted |
| [0013](decisions/0013-portfolio-and-display-currency.md) | Portfolios with average-cost P/L, and display-currency conversion | accepted |
| [0014](decisions/0014-rsi-signals.md) | RSI overbought/oversold zones and buy/sell signals | accepted |
| [0015](decisions/0015-blue-clean-redesign-and-themes.md) | Krestrel's own visual language: blue-clean, light and dark navy, Geist | accepted |
| [0016](decisions/0016-ai-outlook-and-trade-plan.md) | Forward-looking trade plan and AI outlook (news + analyst sentiment) | accepted |
| [0017](decisions/0017-stock-ideas.md) | Stock ideas page (growth / dividend / risky), steered by the portfolio | accepted |
| [0018](decisions/0018-holdings-import-from-screenshot.md) | Import holdings from a broker screenshot (local vision model) | accepted |
| [0019](decisions/0019-holdings-grouping.md) | Group holdings by sector or type (local model) | accepted |
| [0020](decisions/0020-ai-model-choice.md) | Claude or a local model for every AI feature | accepted |
| [0021](decisions/0021-personal-data-guard-for-claude.md) | Keep personal data out of everything sent to Claude | accepted |
| [0022](decisions/0022-dividend-schedule.md) | Show when dividend stocks pay | accepted |
| [0023](decisions/0023-price-alerts.md) | Price alerts | accepted |
| [0024](decisions/0024-portfolio-performance-vs-spy.md) | Portfolio value over time against SPY | accepted |
| [0025](decisions/0025-dividends-received-and-calendar.md) | Dividends received and a dividend calendar | accepted |
| [0026](decisions/0026-target-allocation-and-rebalance.md) | Target allocation and rebalance suggestions | accepted |
| [0027](decisions/0027-yearly-tax-report.md) | Yearly realized P/L and dividends, each at its own date's rate | accepted |
