# 0017: Stock ideas page (growth / dividend / risky), steered by the portfolio

- Status: accepted
- Date: 2026-10-14

## Context

The owner asked for 5–10 stocks worth looking at, using their portfolio as the starting point to find which sectors to add (diversify), with an option to focus on one sector, separated into growth, dividend and risky.

## Decision

- **Ideas page** (`/ideas`, nav "Ideas"): pick "Diversify my portfolio" or one of the 11 GICS sectors, and a Claude model; "Find ideas" calls `POST /api/ideas`.
- **Starting mix computed locally:** open positions across all portfolios valued at live prices (cost basis when unpriced), as weights; falls back to the watchlist (equal weights) when there are no holdings.
- **Claude with web search** (the owner's subscription, `WebSearch`/`WebFetch` only, like ADR 0016) classifies each holding's sector, summarises the spread and gaps, and proposes 6–9 US-listed stocks split growth / dividend / risky, excluding current holdings, within the focus sector if chosen, otherwise mainly in under-represented sectors, each with thesis, fit, main risk, key metrics and sources.
- **Server-side checks:** tickers must parse and exist in the provider's listing (exchange taken from the listing). The listing loads in the background while Claude works; if it can't load, each ticker is checked on its own, and a ticker that can't be checked at all (provider unreachable) is kept rather than failing a multi-minute run; held, duplicate and off-focus ideas are dropped; texts clamped; only http(s) links; fewer than 3 survivors is an error. Live prices come from non-subscribing snapshots. "Watch" adds an idea to the watchlist to chart it.
- **Privacy:** only tickers and their share of the portfolio (percent) are sent, never amounts, share counts or portfolio names; first use asks consent (`krestrel.ideasConsent`). The last result per focus is kept in the browser (`krestrel.ideas`).

## Consequences

- Ideas reflect web sources at the time of the run and can be wrong or stale; each idea shows its risk and sources, and the page says "not financial advice".
- A run takes 1–3 minutes and uses the owner's Claude allowance.
