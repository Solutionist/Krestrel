# 0025: Dividends received and a dividend calendar

- Status: accepted (owner request, 2026-10-15)
- Date: 2026-10-15

## Context

ADR 0022 shows when stocks pay and what the portfolio is expected to earn. The owner also wanted what they have actually received, with a way to correct it to the exact cash their broker paid, and a calendar of what's coming month by month. The hub's schedule cache (`getDividends`) only reaches about 28 months back, and received dividends need every payout since the first trade.

## Decision

- **History:** `hub.getDividendHistory(symbols, fromDay)` (`app/.server/market/dividend-history.ts`) asks the provider's `getDividends` for `[fromDay, today]` and keeps its own per-symbol cache for 6 hours. A cached symbol serves any later start; an earlier start asks again. On failure the uncached symbols are left out (unknown), and so is a symbol whose cache doesn't reach back far enough, rather than undercounting.
- **Overrides:** table `dividend_overrides` (portfolio, symbol, ex-date → USD received after withholding; deleted with the portfolio). Queries in `app/.server/market/db/queries/dividend-overrides.ts`.
- **API:** `GET /api/dividends-received?symbols=&portfolios=&from=` returns `{ ok, today, payouts, overrides }`; `from` must lie between `HISTORY_START` (`app/lib/history-start.ts`, 1990-01-01) and today, else 400. `POST` with `{ intent: "set", portfolioId, symbol, exDate, amount }` or `{ intent: "clear", … }` (same-origin guard; 404 when the portfolio doesn't exist).
- **Working it out** (`receivedDividends` in `app/lib/dividends-received.ts`, in the browser):
  - Per portfolio, from that portfolio's trades only: shares held before the ex-date (`sharesHeldBefore`, as in ADR 0022). A buy on or after the ex-date gets nothing; a sell after it still collects. No shares, no row.
  - Regular and special cash payouts both count. Payouts sharing an ex-date are one payment, so one override covers them.
  - Only payments already paid: pay date (else ex-date) on or before today, New York time.
  - Cash = shares × per share × (1 − withholding ÷ 100). The withholding rate is one percentage for all portfolios, stored in this browser (`krestrel.dividendWithholding`, default 0). An override is the exact cash and ignores the rate.
  - Totals: this calendar year, all of last year, all time, plus a per-year list, by pay date.
- **Hook:** `useDividendsReceived({ portfolioIds, trades, enabled })` loads history since the earliest trade in view (clamped to `HISTORY_START`), applies edits at once and undoes them if saving fails. With `enabled: false` (the portfolio page passes true only on the Dividends and Tax tabs) it requests nothing but keeps what it loaded, so switching between those tabs doesn't load again.
- **Calendar** (`dividendCalendar` in `app/lib/dividend-calendar.ts`): the next 12 months from `dividendTally` (ADR 0022) over current holdings, grouped by pay month, every month listed. Pending payouts count the shares held before their ex-date; later ones today's shares. Amounts use the same withholding rate.
- **UI:** a Dividends tab on the portfolio page (`DividendsPanel`). In the All view each payment names its portfolio and an edit applies to that portfolio.

## Consequences

- Received amounts are only as complete as the provider's corporate actions; a missing record means a missing payment until the owner notices. The owner's edit can only correct payouts the app lists.
- One withholding rate for everything: right for a single treaty rate, approximate when accounts differ.
- Overrides are keyed by ex-date. If the provider later moves a payout's ex-date, its override no longer matches and the worked-out amount returns.
- Dev servers need a restart to pick up the new hub method (ADR 0004).
