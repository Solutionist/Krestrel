# Changelog

All notable changes to Krestrel are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org).

## [Unreleased]

### Security
- Another website can no longer remove a symbol from your watchlist (and delete its alerts) through a hidden form; the watchlist API now accepts only same-site JSON requests.
- The server now answers only to `127.0.0.1` or `localhost` and refuses other host names with 421, which blocks DNS-rebinding attacks.
- Any cross-site request to `/api/*` is refused with 403 for every method, so other sites can't trigger history downloads or upstream calls.
- Pages can no longer be framed by other sites (`X-Frame-Options: DENY` and `frame-ancestors 'none'`).
- On Windows, when the `claude` command isn't on PATH, Krestrel reports it as not installed instead of running whatever `claude.exe` sits in the working folder.
- `ALPACA_STREAM_URL` must now be `wss://`; a plain `ws://` URL, which would send your keys unencrypted, is refused at startup.
- An unknown `MARKET_PROVIDER` such as `constructor` now gives a clear configuration error.
- Alpaca and Tavily keys are redacted from logs.
- The health check no longer returns raw database errors; it reports "timed out" or "unreachable" and logs the details.

### Fixed
- A trade that failed to save (overselling, missing portfolio) no longer adds its symbol to the watchlist; symbols are added only after the trade is saved.
- Trade shares, price and fee are rounded to what the database stores before checks run, number errors read in plain English, and future trade dates are refused (also in screenshot import).
- Deleting a portfolio while a trade is being saved can no longer leave an orphaned write.
- Removing and reordering watchlist symbols at the same time no longer race each other.
- Daily history backfill now fills older years back to `DAILY_HISTORY_YEARS` as well as recent days, never stores a half-fetched range, and stops promptly on shutdown.
- Alpaca REST requests now time out after 60 seconds instead of hanging.
- The market clock no longer keeps polling after the server stops.
- Closing the page that asked for an AI outlook, ideas, screenshot import or grouping now stops the model run, so other AI features aren't left "busy" for minutes.
- An invalid `OLLAMA_URL` now gives a clear configuration error instead of a crash.
- Holding groups now use `CLAUDE_TIMEOUT_MS` on Claude and Ollama's own timeout locally.
- A valid card number next to other digits (for example `Card 4111111111111111 123`) is now masked.
- Exchange-rate lookups before a currency's first published rate no longer borrow a rate from years later.
- Selling a position in fractional lots no longer leaves tiny phantom dividends afterwards.
- Portfolio "Today" change is no longer diluted by holdings with no price for yesterday.
- Renaming a portfolio can no longer rename a different one after switching portfolios.
- The tax report now says when dividends may be incomplete, not only when they failed entirely.
- An old save error no longer reappears after reading another screenshot in import.
- Profit and loss figures now show ▲/▼ next to the colour everywhere.
- The AI outlook is no longer sent stale candles after an interval change or failed load.
- Live updates no longer pile up in memory after a chart history load fails.
- When browser storage is blocked, settings keep their in-memory value instead of all reverting.
- The chart no longer reloads on first paint when the saved theme differs from the system theme.
- AI consent checks no longer throw when browser storage is blocked.
- "Retrying in N s" no longer causes a hydration mismatch.
- Screen readers on the ideas page now hear only loading, error or "Ideas ready", not every price tick.
- The same for the outlook panel: "Working…", the error, or "Outlook ready".
- The watchlist price flash now restarts on every tick.
- The outlook toggle's tooltip now describes what it does.

### Changed
- `bun run start` always serves on 127.0.0.1:3000.
- The Docker Compose app service is restored.

### Added
- MIT licence.
- Issue and pull request templates.
- Dependabot for Bun packages, the Dockerfile and Docker Compose.
- README screenshots from the mock provider.
- CI (typecheck, lint, tests against Postgres, build) and CodeQL scanning on GitHub Actions; CodeRabbit review settings; Dependabot for GitHub Actions.

## [1.0.0] - 2026-10-15

First release. A personal, self-hosted, real-time NYSE/Nasdaq ticker that runs on your own computer (loopback only, never places orders).

### Added

#### Markets
- Watchlist of up to 30 symbols with live prices (Alpaca, or the offline `mock` provider).
- Charts from 1-minute to 1-year bars with up to 10 years of daily history; Candles or Heikin Ashi; EMA, Bollinger Bands, RSI; hindsight analysis.
- Dividend schedule and yield under the chart.
- Price alerts: above/below a price, shown on the chart and watchlist, with an in-app notice and optional browser notification (ADR 0023).

#### Portfolio
- Named portfolios of buys and sells (average-cost P/L), screenshot import, holdings grouping by sector or type, average-down calculator, display currency.
- Expected dividends and a Next dividend column with yield.
- Performance over time against SPY with time-weighted returns (ADR 0024).
- Dividends received, worked out from your trades, with tax withheld and per-payment corrections, plus a 12-month dividend calendar (ADR 0025).
- Rebalance helper towards target weights; suggestions only (ADR 0026).
- Yearly tax report of realized P/L and dividends in your currency, at each date's ECB rate, with CSV export (ADR 0027).

#### AI (opt-in)
- AI outlook, stock ideas and screenshot import on your own Claude Code subscription or a local Ollama model, chosen per feature (ADR 0020), with personal data masked before anything goes to Claude (ADR 0021).

[Unreleased]: https://github.com/Solutionist/Krestrel/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/Solutionist/Krestrel/releases/tag/v1.0.0
