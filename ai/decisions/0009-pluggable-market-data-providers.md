# 0009: Pluggable market-data providers

- Status: accepted (implemented in Phase 2)
- Date: 2026-10-14

## Context

Alpaca is the first data source, Finnhub is planned, and others may follow. The owner asked for an architecture where a new API can be integrated without touching the rest of the app. Early drafts leaked Alpaca specifics into shared code: a hard-coded 30-symbol limit, a fixed list of bar `source` values, and Alpaca keys in the global env schema.

## Decision

A provider is a self-contained folder `app/.server/market/<id>/` that implements `MarketDataProvider` (`app/.server/market/provider.ts`) and is registered with one line in `app/.server/market/registry.ts`.

Each provider owns, and nothing else knows:

| Concern | How the provider declares it |
|---|---|
| Config / secrets | Its own Zod schema over `context.env`, parsed with `parseConfig(…, "<Name> provider")`. The app env schema knows only `MARKET_PROVIDER` |
| Upstream shapes | Zod schemas + normalizers inside its folder; emits only `Tick`, `Bar`, `ConnectionStatus`, `MarketClock`, `QuoteSnapshot`, `Asset` (`app/lib/market.ts`) |
| Limits | `maxSymbols` (watchlist limit), `maxSymbolsPerHistoryRequest`, `historyDelayMs` |
| Data provenance | `liveSource` / `historySource` ids written to `bars_1m.source` (free-form, validated snake_case) |
| Honesty label | `liveDataLabel` shown in the UI |
| Reconnects / errors | Internal; surfaced only as `ConnectionStatus` with plain-language `reason` |

The rest of the app depends only on the contract:

- `MarketHub` gets a provider from the registry (`MARKET_PROVIDER`), enforces `maxSymbols`, and stores bars with the provider's source ids.
- Chart queries take `historySource` / `liveSource` as parameters (ADR 0005 generalized: history wins, live fills the tail).
- The UI reads `ProviderInfo` (`id`, `displayName`, `liveDataLabel`, `maxSymbols`) from the SSE `snapshot` event.
- Logging redacts generic secret-shaped paths (`key`, `secret`, `token`, `headers`, …), not provider-specific names.

## Consequences

- Adding Finnhub: new folder + tests + one registry line + its variables in `.env.example`. No schema migration, no hub/route/UI change (checklist in `ai/market-data.md`).
- Bars from different providers coexist (different `source` ids); switching providers doesn't corrupt history.
- One active provider per process. Composing providers (e.g. Finnhub live + Alpaca history) would be a new provider that wraps two others behind the same contract.
- `MockProvider` doubles as the contract's reference implementation and the offline/E2E data source.
