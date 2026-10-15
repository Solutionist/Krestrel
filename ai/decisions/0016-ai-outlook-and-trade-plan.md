# 0016: Forward-looking trade plan and AI outlook (news + analyst sentiment)

- Status: accepted (owner decisions, 2026-10-14). Replaces the "explain past trades" part of ADR 0012.
- Date: 2026-10-14

## Context

The owner found Insights backward-looking ("only shows past data") and asked for guidance on **at what price to buy and where to sell**, plus **sentiment from the web, analyst (bank) research and company news**. Decisions made with the owner: news from **both** Alpaca's news feed (Benzinga headlines, existing keys) **and** Claude web search (analyst ratings and price targets, other coverage); the AI panel's old explanation of past trades is **replaced** by a forward-looking outlook.

## Decision

- **Local trade plan** (`app/lib/trade-plan.ts`, no AI, always on in Insights): from the chart's own analysis window and levels. Bias from the slow EMA's slope and price position; buy zone around the nearest support below price (−0.25 ATR / +0.5 ATR), or the 20 EMA in an uptrend without support; **no buy zone in a downtrend**; stop just below the next support if within 3 ATR, else 1 ATR below the zone; targets at the next resistances (or the period high); reward : risk from the zone's middle. Deterministic and tested; labelled "a plan, not advice".
- **AI outlook** (`POST /api/outlook/:symbol`, explicit click, first-use consent): the server analyses the same candles the chart shows, builds the local plan, pulls up to 20 Alpaca headlines from the last 30 days, and asks Claude (the owner's subscription via the Claude Code CLI, model picked in the panel) for: overall sentiment, Wall Street consensus and 12-month targets, cited recent news with tone, a plan (stance buy / wait / hold / trim / avoid, buy zone, stop, targets, rationale) and risks. Claude may use **only** `WebSearch` and `WebFetch` for this call (no shell, files or MCP). Output is schema-validated, then sanitised: texts clamped, only http(s) links, prices outside sane bands of the last price dropped.
- **Chart:** a "Plan" overlay draws buy zone, stop and targets; it shows the AI plan when an outlook exists for the current symbol and interval, otherwise the local plan.

## Consequences

- Data leaving the machine on click: ticker, the displayed candles, and Benzinga headlines (already personal-use data) go to Anthropic; Claude's web searches go to the open web. Nothing else (no keys, portfolio or watchlist).
- Web-sourced facts can be wrong or stale; the panel shows sources, dates and "not financial advice". Runs take 1–3 minutes and use more of the owner's Claude usage than the old explanation.
- `/api/analysis/:symbol` and its explanation code are removed (clean cutover).
