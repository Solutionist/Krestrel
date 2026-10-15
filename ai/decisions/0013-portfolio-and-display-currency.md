# 0013: Portfolios with average-cost P/L, and display-currency conversion

- Status: accepted (owner decisions, 2026-10-14)
- Date: 2026-10-14

## Context

The owner asked to record holdings ("how much stock I own, at what price I bought") in named portfolios, see profit and loss, and view amounts in another currency (e.g. USD → Thai baht). Four choices were made with the owner:

1. **Several named portfolios**, plus an "All portfolios" total.
2. **Buys and sells**: realized and unrealized P/L, not just current holdings.
3. **Currency: today's rate for everything.** P/L is computed in USD and the result converted at the latest rate. Simpler than using the rate on each buy date, at the cost of hiding currency gains/losses (a weaker baht raises THB value without showing why).
4. **Rates: European Central Bank daily reference rates via [Frankfurter](https://frankfurter.dev)** (`https://api.frankfurter.dev/v2/providers/ecb/rates?base=USD`): free, no key, ~30 currencies including THB.

## Decision

- **Ledger, not snapshots.** `portfolios(id, name unique ignoring case)` and `trades(portfolio_id → portfolios ON DELETE CASCADE, symbol, side buy|sell, shares numeric(18,6), price, fee, traded_on date)`. Positions are derived, never stored: `computePositions()` in `app/lib/portfolio.ts` replays a portfolio's trades.
- **Average-cost method** (what most retail brokers show): a buy adds `shares × price + fee` to cost; a sell realizes `shares × (price − average cost) − fee` and removes `shares × average cost`. A full sell resets cost, so a later buy starts a fresh average. "All portfolios" merges per-portfolio results by symbol (sums), so totals equal the sum of the portfolios.
- **Replay order:** trade date, then a day's buys before its sells (entering a day's trades in any order works), then entry order.
- **No overselling, ever.** Add, edit and delete re-run the replay under a per-portfolio advisory lock and refuse any change that leaves a sell larger than the shares held on its date (e.g. deleting a buy that a later sell depends on). The stored ledger therefore always replays.
- **Prices come from the live stream**, which only covers watchlist symbols, so recording a trade adds its symbol to the watchlist. Unknown tickers are refused; a full watchlist or unreachable provider still saves the trade with a warning, and that holding is left out of value totals (listed as "no live price").
- **"Today"** is shares held now × (last − previous close): it ignores intraday buys/sells, a deliberate simplification.
- **Trades are recorded and shown in USD** (as on a US broker statement). Holdings, totals and the chart header's "≈" price are converted for display only (`useCurrency()`), with the rate, source and date shown.
- **Rates are cached in memory for 6 h** (`FxRateCache`); a failed refresh keeps serving the last good rates and retries after 5 min. With no rates at all, the UI says so and shows USD.

## Consequences

- Only currency codes leave the machine for rates; no market, portfolio or account data is sent, so the personal-use data licence is unaffected. This is not trading: Krestrel places no orders.
- Switching to per-buy-date rates later needs historical rates per trade date (Frankfurter supports `date=`); the ledger already stores `traded_on`.
- Splits are not adjusted: a split needs a manual edit of the affected trades.
- Amended by ADR 0027 (2026-10-15): the yearly report converts each sell and dividend at its own date's rate. For that, the currency code and one start date (the earliest trade or dividend) go to Frankfurter; still no trade, portfolio or account data. Everywhere else keeps today's rate.
