# 0012: Hindsight chart analysis, explained by Claude via the user's subscription

- Status: accepted (owner decisions, 2026-10-14); the past-trade explanation (`/api/analysis`) is superseded by ADR 0016 (AI outlook)
- Date: 2026-10-14

## Context

The owner asked to use Claude "with the chart (using subscription)" to tag the best past buy/sell locations and show support lines. Three decisions were made with the owner:

1. **Access: the local Claude Code CLI on the owner's subscription.** Anthropic's [legal & compliance page](https://code.claude.com/docs/en/legal-and-compliance) (read 2026-10-14) says subscription OAuth is for "ordinary use of Claude Code and other native Anthropic applications"; third-party apps must not "collect, store, or intermediate Claude.ai credentials"; and it does not prevent "an end user from signing in to the unmodified Claude Code binary with their own Claude subscription". Krestrel therefore runs the user's own, unmodified `claude` binary and never handles credentials. API-key billing remains the unambiguous alternative; the backend is pluggable for it.
2. **Data: sent only on an explicit click.** The Alpaca data licence is personal-use, no redistribution. Sending candles to Anthropic for the owner's own analysis is most plausibly processing, not redistribution; the owner accepted that, with a first-use consent prompt naming what is sent.
3. **Method: the local algorithm finds the points; Claude ranks and explains.** LLMs are unreliable at locating exact extremes in long numeric series.

## Decision

- `app/lib/analysis.ts` (pure, browser and server):
  - ZigZag swing pivots with a volatility-adapted threshold (3 × ATR(14) / price, clamped 1–25%).
  - Best past round trips: exact DP for the *k* (default 3) non-overlapping swing-low→swing-high trades with the greatest combined log return.
  - Support/resistance: confirmed pivots clustered within max(0.5 ATR, 0.4% of price), ≥ 2 touches, up to 3 per side of the last close (S1…, R1…).
  - Trend support: line through the last two confirmed higher lows, extended to the last candle; flagged when broken.
- Explanation style (owner feedback): terse, fact-based one-liners (≤ 90 chars; summary ≤ 160) citing per-trade facts computed locally (`app/lib/trade-context.ts`: RSI, volume vs 20-bar average, EMA50 distance, nearby level); trimmed server-side as a backstop. Shown in a dedicated Insights column, never over the chart.
- Chart: "Buy/Sell" and "S/R" toggles draw markers (`createSeriesMarkers`), dashed price lines, and the trend line. Recomputed on load, on each new candle, and right before asking Claude.
- "Ask Claude": the browser posts the exact displayed candles to `POST /api/analysis/:symbol`; the server re-runs the same analysis (so ids match the drawing), builds a compact numeric prompt (≤ 300 most recent candles + all candidates by id), and calls the LLM for a Zod-validated `ExplanationSchema` result. Comments about unknown ids are dropped.
- LLM backend contract `app/.server/llm/types.ts` (`LlmClient.generateStructured`), registry `LLM_PROVIDER` (`claude-cli` | `none`). `claude-cli`:
  - `claude -p --output-format json --json-schema <draft-07, no $schema> --system-prompt … --tools "" --strict-mcp-config --disable-slash-commands --no-session-persistence [--model]`.
  - Prompt on stdin; run in an empty scratch dir (no project CLAUDE.md/hooks/MCP); minimal env (HOME, USER, PATH, …). No Krestrel secrets, and no `ANTHROPIC_API_KEY`, which would switch billing to the API.
  - The CLI reports failures with exit 0 and `is_error: true`; mapped to `not_signed_in`, `rate_limited`, `not_installed`, `timeout`, `invalid_output`, `busy` with plain-language messages.
  - One run at a time per process.

## Consequences

- Works only where the `claude` CLI is installed and signed in; not inside the Docker image (shows "isn't installed here").
- Uses the owner's Pro/Max limits; Anthropic "reserves the right to take measures to enforce these restrictions … without prior notice". If that changes, add an API-key backend in `app/.server/llm/` (one registry line).
- This is a documented exception to "never share data" in `CLAUDE.md`: user-initiated, per-chart, consented.
- Hindsight only; UI copy says "not financial advice" and Claude is instructed not to predict.

## Update (owner feedback)

- The panel is named **AI analysis** (by Claude) with one action, "Analyze this chart", to avoid two buttons both called "Ask Claude".
- The owner picks the model per analysis (Default, Haiku, Sonnet, Opus, Fable: Claude Code aliases that resolve to the latest model of each tier), remembered in `krestrel.claudeModel`. The server accepts only these values and passes the alias as `--model`; `default` falls back to `CLAUDE_MODEL` / the CLI default.
- Insights and AI analysis look only at the chart interval's period (`analysisWindow`: e.g. 1D → last year), not all loaded history; a trading-style picker (Day trade, Swing, Position, Long term) sets the interval, so day traders and long-term investors each get swings at their own scale.
