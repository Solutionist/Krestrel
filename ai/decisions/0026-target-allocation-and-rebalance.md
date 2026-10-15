# 0026: Target allocation and rebalance suggestions

- Status: accepted (owner request, 2026-10-15)
- Date: 2026-10-15

## Context

The owner wanted to set a target mix for a portfolio (for example 40% VOO, 20% AAPL) and see what to buy, or sell, to get back to it, usually when adding new cash. Krestrel records trades but never places orders (CLAUDE.md), so this can only be a calculation.

## Decision

- **Storage:** `portfolio_targets` (portfolio id, symbol, weight in percent `numeric(7,4)`, 0 < weight ≤ 100; key portfolio + symbol; deleted with the portfolio). Targets belong to one portfolio; "All portfolios" has none, and the panel asks the owner to pick one.
- **API:** `GET /api/portfolio-targets?p=<id>` lists them; `POST` with `{ portfolioId, targets }` replaces the whole set in one transaction with the portfolio row locked, so a save is all or nothing and concurrent saves apply in order. `TargetsSchema` (`app/lib/rebalance.ts`, shared by the page and the server) checks valid tickers, one row per symbol, weights 0.01–100 kept to 4 decimals, and a total of at most 100% (+0.01 for rounded percentages). Same-origin guard as the other actions.
- **Maths** (`planRebalance`, pure):
  - Percentages are of the priced holdings plus the new cash. Targets adding up to less than 100% keep the rest as cash; targets adding up to over 100% (the 0.01 rounding allowance) are scaled down to 100%, so a plan never spends more than it sells plus the new cash.
  - A holding without a target counts as target 0.
  - **Buy and sell:** every row moves exactly to its target. Holdings without a target are sold in full.
  - **Buy only** (default): nothing is sold, and holdings without a target are left alone. New cash goes to the holdings below target. When it can't cover every gap, it fills them by water-filling: each underweight holding ends at the same fraction of its target value, so the furthest behind catch up first. Cash left over after every gap is filled stays as cash.
  - **Shares:** each trade shows exact shares (6 decimals) and whole shares. Whole-share buys round down and sells round up, capped at the shares held, so whole-share sells always pay for whole-share buys. Selling a holding in full sells exactly the shares held, fractions included. Trades under half a cent show as Hold.
  - **Missing prices:** held stocks without a live price are left out, target included, and named in a note. A target the owner doesn't hold yet takes its price from the page's live quotes (watchlist); it always gets a dollar amount, and without a quote there is no share count.
- **Prefill:** with nothing saved, the editor starts from today's weights (`currentWeights`: hundredths of a percent adding up to exactly 100%, largest remainder). "Use current weights" does the same at any time. Edits update the suggestions live, before saving.
- **UI:** the panel says it only suggests and never places orders. Buys and sells show as ▲ Buy / ▼ Sell text in the rise/fall colours. Amounts use the display currency; the cash input is in USD like the trade ledger.

## Consequences

- Suggestions use live prices, so they change as prices move. They include no fees or taxes.
- Targets for one portfolio don't affect any other portfolio. Deleting a portfolio deletes its targets.
- Buy only can leave stocks above target until enough new cash arrives. The panel names them.
