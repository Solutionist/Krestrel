# Changelog

All notable changes to Krestrel. Versions follow [Semantic Versioning](https://semver.org).

## 1.0.0 — 2026-10-15

First release. A personal, self-hosted, real-time NYSE/Nasdaq ticker that runs on your own computer (loopback only, never places orders).

### Markets
- Watchlist of up to 30 symbols with live prices (Alpaca, or the offline `mock` provider).
- Charts from 1-minute to 1-year bars with up to 10 years of daily history; Candles or Heikin Ashi; EMA, Bollinger Bands, RSI; hindsight analysis.
- Dividend schedule and yield under the chart.
- Price alerts: above/below a price, shown on the chart and watchlist, with an in-app notice and optional browser notification (ADR 0023).

### Portfolio
- Named portfolios of buys and sells (average-cost P/L), screenshot import, holdings grouping by sector or type, average-down calculator, display currency.
- Expected dividends and a Next dividend column with yield.
- Performance over time against SPY with time-weighted returns (ADR 0024).
- Dividends received, worked out from your trades, with tax withheld and per-payment corrections, plus a 12-month dividend calendar (ADR 0025).
- Rebalance helper towards target weights; suggestions only (ADR 0026).
- Yearly tax report of realized P/L and dividends in your currency, at each date's ECB rate, with CSV export (ADR 0027).

### AI (opt-in)
- AI outlook, stock ideas and screenshot import on your own Claude Code subscription or a local Ollama model, chosen per feature (ADR 0020), with personal data masked before anything goes to Claude (ADR 0021).
