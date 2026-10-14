# 0014: RSI overbought/oversold zones and buy/sell signals

- Status: accepted
- Date: 2026-10-14

## Context

The owner asked for the RSI to show when a stock is overbought or oversold, for one range (levels) that applies to every stock they hold, and for some indication of whether to buy or sell based on the data.

## Decision

- **Levels: one global setting**, default 70/30 (Wilder's), editable under Indicators → RSI levels (overbought 55–95, oversold 5–45, whole numbers; `RsiLevelsSchema`). Stored in localStorage `krestrel.rsiLevels` and shared live by the chart, watchlist, header and portfolio (`createStoredValue`).
- **States** (`app/lib/rsi-signal.ts`, `rsiSignal`):
  - `oversold` (RSI ≤ oversold) / `overbought` (RSI ≥ overbought): a zone, not yet a signal.
  - `buy`: RSI rose from ≤ oversold back above it within the last 3 bars. `sell`: fell from ≥ overbought back below it within the last 3 bars. This "leaves the zone" rule is the textbook RSI entry/exit: it waits for momentum to turn instead of buying a falling stock.
  - `neutral` otherwise.
- **Signals for every stock use the daily RSI(14)**, regardless of the chart's interval: it is the timeframe the rule is usually quoted for and doesn't flip every few minutes. `/api/signals` returns about a year of daily closes per watchlist symbol (Wilder's RSI needs ~10× its period to settle); the browser folds in the live price as today's close (`liveCloses`) so signals update in real time. Holdings are always on the watchlist (ADR 0013), so every holding has a signal.
- **The chart's RSI pane** uses the chart's interval: shaded zones above overbought (red) and below oversold (green) via two baseline series, dotted level lines with axis labels and a faint 50 line, and Buy/Sell markers where RSI leaves a zone (latest full size with its label, older ones small). The legend adds the state at the cursor.
- **Wording:** every signal shows ▲/▼ plus colour, a one-sentence explanation, and "a momentum rule of thumb, not financial advice" in its tooltip. RSI alone ignores trend: in strong trends it can stay overbought/oversold for long periods.

## Consequences

- No new upstream data: signals are computed from stored daily bars and the live stream.
- A trend filter (e.g. only buy signals above the 200-day average) or per-stock levels can be added later on top of `rsiSignal`.
