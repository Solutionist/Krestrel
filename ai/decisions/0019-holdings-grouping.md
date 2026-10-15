# 0019: Group holdings by sector or type (local model)

- Status: accepted (owner request, 2026-10-15)
- Date: 2026-10-15

## Context

The owner asked to group portfolio holdings by sector and by type (growth / dividend). The market data provider (Alpaca) has no sector or style data. The owner chose:

1. **Their own local Ollama model** to classify (free, offline, private), rather than Claude with web search or manual tagging only.
2. **Growth · Dividend · Risky**, the same types as the Ideas page (ADR 0017), so suggestions and holdings line up.

## Decision

- **Data:** table `stock_profiles(symbol PK, sector GICS|null, style growth|dividend|risky|null, source model|owner, updated_at)`. `sector` is null for funds/ETFs and unknowns. Queries in `db/queries/stock-profiles.ts`. `saveModelProfiles` never changes a field the owner set; on an owner row it only fills an empty `style`, which happens when the owner set a sector before the stock was classified. `needsClassifying` (`app/lib/stock-profile.ts`): no profile yet, or `style` null. The server and the page both use it.
- **Classification** (`app/.server/stock-profiles/classify.ts`): one request per batch (≤ 100 tickers) to the grouping AI, by default the local `OLLAMA_MODEL` (formerly `OLLAMA_VISION_MODEL`); since ADR 0020 the owner can pick another local model or Claude. The request carries each ticker plus its company name from the cached provider listing, and asks for a schema-constrained answer: sector from the 11 GICS sectors or null, and the single best style. Only tickers that were asked about are kept, once each. Tickers the model skips stay unclassified and are retried on a later visit. The database also refuses any sector outside those 11 (`stock_profiles_sector_check`).
- **Shared AI clients** (`app/.server/llm/`, ADR 0020): one `LlmClient` interface for Ollama and Claude, one `LlmError`, and `aiFailureResponse` (AI/config failure → `{ok:false,error}` with 503/504/502). Used by screenshot import (ADR 0018), classification and the Claude features.
- **API:** `POST /api/stock-profiles` takes `{intent:"classify", symbols, ai?}` (classifies only the tickers `needsClassifying`, then returns all of them) or `{intent:"set", symbol, sector, style}` (the owner's correction). Same-origin only; failures map as in ADR 0018. A correction the server rejects is undone on the page.
- **UI:** the Holdings header has "Group: None · Sector · Type", remembered in `krestrel.holdingsGrouping`. When grouping is on, holdings without a profile are classified once per page visit (status line, Try again on error). Each group shows its count, value and share of priced value; groups run largest first, with the unclassified group ("Funds & unclassified" for sectors) last. Rows keep the column sort within a group. Each row has a small sector or type menu for corrections, which show at once and are saved as `owner`.

## Consequences

- With a local model, only tickers and company names go to the owner's Ollama; nothing leaves the machine. With Claude chosen for grouping, they go to Anthropic automatically whenever grouping is on.
- The model's knowledge can be stale for new listings or recent pivots; the per-row correction is the fix, and it is permanent.
- With a 27B model on an RTX 4090, six tickers took ~9 s including model load.
- Without Ollama, grouping still works for tickers already classified or corrected; the rest appear as unclassified, with an error and Try again.
