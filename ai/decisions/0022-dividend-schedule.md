# 0022: Show when dividend stocks pay

- Status: accepted (owner request, 2026-10-15)
- Date: 2026-10-15

## Context

The owner asked that stocks paying a dividend say when they pay. They chose all three places: the chart page, portfolio holdings and stock idea cards. They wanted the schedule plus the next dates (frequency, amount, next ex-dividend date and pay date), estimated when not yet announced.

Alpaca's market data has `GET /v1/corporate-actions?types=cash_dividend` with `rate`, `special`, `ex_date`, `record_date` and `payable_date`. It is available on the owner's plan, verified with a live request. The date range filters on `process_date` (about the pay date), so a window reaching a few months ahead also returns payments already announced. Records Alpaca hasn't finished processing are withheld; `data_quality=all` returned nothing extra in testing, so the default is kept.

## Decision

- **Provider contract:** `getDividends(symbols, startDay, endDay)` returns cash dividends `{ symbol, exDate, payDate, amount, special }`, oldest first.
  - Alpaca: 100 symbols per request, follows `next_page_token`, Zod-validated.
  - Mock: deterministic and simulated. About 40% pay nothing, the rest quarterly or monthly at 1–5% a year. Only payments up to a month ahead count as announced, so expected dates show up too.
- **Hub:** `getDividends(symbols)` asks for about 28 months back and 4 months ahead (`DIVIDEND_LOOKBACK_DAYS`, `DIVIDEND_LOOKAHEAD_DAYS`) and caches each symbol for 6 hours. The provider's window is by pay date, and a yearly payer needs two payments in it even when its latest is close to stale: hence the 455-day staleness limit + a year + 45 days for the gap between ex-date and pay date. On failure the uncached symbols are left out (unknown), never reported as paying nothing.
- **Schedule** (`dividendInfo` in `app/lib/dividends.ts`, shared by server and page):
  - Only regular payments count; specials are ignored.
  - No regular payment in the last 15 months (`DIVIDEND_STALE_DAYS`, 455 days) means no dividend (`null`).
  - Frequency is the median gap between the latest regular ex-dates: up to 45 days monthly, 120 quarterly, 240 twice a year, 420 yearly, otherwise irregular. A single payment is irregular.
  - `last` is the newest payment whose ex-date has passed. `next` is the first announced payment after today; otherwise `last` moved on by the frequency in calendar months (1 monthly, 3 quarterly, 6 twice a year, 12 yearly; repeatedly, until it lies after today), marked `expected`. Calendar months, not the day gap: a month-end payer's ~31-day gap would otherwise jump past February and skip a month. An irregular payer gets no estimate.
- **API:** `GET /api/dividends?symbols=A,B` (1–100 symbols, `MAX_DIVIDEND_SYMBOLS`) returns `{ ok, today, dividends: { SYMBOL: DividendInfo | null } }`, computed for today's New York date. `useDividends` splits larger sets into several requests and merges them; a request that fails leaves its symbols unknown.
- **UI** (`useDividends`, `app/components/dividend-text.tsx`):
  - **Chart page:** a line at the bottom of the chart card, loaded once for the whole watchlist. It shows "Dividend · Pays quarterly · $0.53/share (≈2.9% a year) · Next: buy before Dec 17 (ex-dividend date), paid Jan 2, 2027 · expected, not yet announced". When the last payment's ex-date has passed but its pay date hasn't, it adds "Last one: pays Oct 15 to holders before Sep 30 (ex-dividend date)".
  - **Idea cards:** the same line at the bottom, above Watch.
  - **Holdings:** a "Next dividend" column with the next payment the owner actually gets (from the tally below) and the cash for their shares in the display currency. "expected" marks estimates, "—" means no dividend, and the tooltip carries the full sentence.
  - **Portfolio tally** (owner request, same day; `dividendTally` in `app/lib/dividends.ts`, `dividend-income.tsx` under the summary):
    - **A year:** the shares held now × the current amount × payments a year (irregular payers excluded), with a per-month figure and the yield on market value and on cost. The yields count only holdings with a live price (`pricedYearly`), the same ones the value and cost totals cover; the yearly figure itself includes all of them.
    - **Next 90 days:** every payment due by pay date, projected forward in calendar months (1 monthly, 3 quarterly, 6 twice a year, 12 yearly; same day of the month, or the month's last day when shorter, `projectDividends`) and marked "expected", listed as date · stock · shares × per share · amount. Stepping by an average day count instead would skip February for monthly payers and put two payments in another month.
    - **Entitlement:** a payout whose ex-date has passed counts the shares held before that date (`sharesHeldBefore` over the trades in view). So a buy after the ex-date adds nothing, and a sell after it still collects. Closed positions are included for that reason, but they add nothing to the yearly figure.
    - Shows "No dividend stocks in this portfolio." when nothing pays. Held stocks without data (provider unavailable) are listed as not included, and with no data at all the card says the data is unavailable instead.
  - The yield is the next (or last) amount × payments a year ÷ the live price. Amounts per share show 2–4 decimals ($0.2715).

## Consequences

- **Lag:** announcements can reach Alpaca late, so a payment the company has declared may still show as "expected" for a few days. Monthly payers whose latest record is missing roll the estimate one period forward.
- **Holdings and tally:** both are estimates before tax, in USD converted for display. They assume today's shares stay held to each future ex-date, and today's amount continues.
- **Not shown:** stock dividends, capital-gains distributions and other corporate actions.
- **Dev servers:** the hub singleton survives hot reloads (ADR 0004), so a running dev server needs a restart to pick up the new hub method.
