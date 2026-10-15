# 0027: Yearly realized P/L and dividends, each at its own date's rate

- Status: accepted (owner request, 2026-10-15)
- Date: 2026-10-15

## Context

The owner wanted a yearly summary for their records: realized profit/loss and dividend income per calendar year, in their own currency (e.g. Thai baht). A tax return in another currency counts each sale and payment at the rate on its date, not today's rate. The holdings and totals convert at today's rate (ADR 0013), which hides currency gains and losses, so this report needs past rates.

Frankfurter serves ECB reference rates as a time series: `GET https://api.frankfurter.dev/v2/providers/ecb/rates?base=USD&quotes=THB&from=YYYY-MM-DD` returns `[{date, base, quote, rate}]` for every ECB business day from `from` to the latest (verified with a live request: ~7,000 rows and ~450 KB from 1999; weekend days are missing; an unknown code returns 422).

## Decision

- **Data sent:** only the currency code and one start date (the earliest trade or dividend in view). No trade, portfolio or account data leaves the machine, so ADR 0013's reasoning still holds.
- **Server cache** (`FxHistoryCache`, `app/.server/fx/history.ts`): one series per currency in memory, fetched from 10 days before the requested start (`LEAD_DAYS` = `MAX_RATE_AGE_DAYS`) so a start on a weekend or holiday still has the previous rate. A later start is served from the cache; an earlier one refetches from there. Refreshes when older than 6 h; a failed fetch keeps serving the cached series and backs off 5 min.
- **API:** `GET /api/fx/history?quote=THB&from=YYYY-MM-DD` → `{ok, quote, rates: {day: rate}}`. 400 for a code that isn't three capital letters, isn't in today's ECB set (or is USD), a date before 1999 or after today (New York); 502 when unavailable. The panel clamps an earlier start (a pre-1999 trade) to 1999-01-01. The browser (`useFxHistory`) reuses a loaded series for 6 h and within the same New York day, then asks again so a new day's sell gets its rate.
- **Rate for a day** (`rateOnDay`): the latest rate published on or before it, so weekends, holidays and today before the ECB publishes use the previous business day. A day before the first rate uses the first. A latest rate more than `MAX_RATE_AGE_DAYS` (10) calendar days older counts as no rate: the ECB's own closures are shorter, but it paused some currencies for years (ISK: 2008-12-03 to 2018-02-01), and a stale rate is never used. Sells (or sells from a buy) and dividends without a rate are left out of that year's local-currency sums and counted (`TaxYear.unconverted`); their USD amounts still count, the expanded sells show "No THB rate for this date", the panel names the affected years, and the CSV leaves their local cells empty.
- **Maths** (`taxReport`, `app/lib/tax-report.ts`): replays the trades in the same order and with the same average-cost method as `computePositions` (ADR 0013), per portfolio and stock, in USD and in the display currency side by side:
  - A buy adds `shares × price + fee` in USD, and that amount × the buy date's rate in the local currency.
  - A sell realizes proceeds `shares × price − fee` (× the sell date's rate locally) minus the same fraction of each currency's average cost. A full sell resets both.
  - So the USD realized total equals the holdings' realized P/L (tested).
  - **Currency effect** of a sell = local gain − USD gain × the sell date's rate: the part of the local result that comes from the rate moving between buying and selling (positive when the dollar strengthened). Shown per year under the expanded sells, with the USD result.
  - A sell counts in the calendar year of its trade date. Dividends are `ReceivedDividend.cash` (ADR 0025: net cash received) at the pay date's rate, in the pay date's year (ex-date when the pay date is unknown).
- **UI** (`TaxReportPanel`): Year · Proceeds · Cost · Realized P/L · Dividends · Total, newest year first, with ▲/▼ on gains and losses. Each year expands to its sells with the rate used. "Download sells (CSV)" builds the file in the browser; nothing is uploaded. Dividends show "…" while loading; when they can't be loaded (`receivedError`) they show "Unavailable" with the reason. For USD no rates are fetched (rate 1). When past rates can't be loaded, the report shows USD with the reason. Note: "For your records, not tax advice. Rates: European Central Bank, each trade's own date."

## Consequences

- ECB rates are reference rates, not the rate a broker or bank actually applied; tax rules may require a different source or method (e.g. FIFO, or a yearly average rate). This is a record, not tax advice.
- Only currencies the ECB publishes against USD are available, the same set as the display-currency picker.
- The CSV lists sells only; dividends are in the year table. Stock splits are not adjusted (ADR 0013).
