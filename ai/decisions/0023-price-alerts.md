# 0023: Price alerts

- Status: accepted (owner request, 2026-10-15)
- Date: 2026-10-15

## Context

The owner asked for price alerts on the Markets page: set a price above or below the current one for a watched stock, see it on the chart, and be told when a trade reaches it, even with the tab in the background. Phase 4 of the architecture had reserved an alert engine in the hub and an `alert` SSE event, and the `alerts` table (with `markAlertTriggered`, a conditional update) already existed.

## Decision

- **What fires:** `above` fires on a trade at or above the target, `below` at or below it (`ALERT_MET` in `app/lib/alerts.ts`). Touching the target counts. Only live trades (ticks) are checked, never snapshot quotes: a snapshot repeats an old trade price, and firing on it after a restart would surprise. An alert set on the wrong side of the price fires on the next trade, and the form says so before saving.
- **Exactly once:** `AlertEngine` (`app/.server/market/alert-engine.ts`) keeps the active alerts in memory by symbol, loaded at hub start and updated on create and delete; `hub.removeSymbol` calls `forgetSymbol` after the cascade delete so removed symbols leave no stale entries. Each tick costs a map lookup. A reached alert leaves the set at once; `markAlertTriggered` then deactivates it only if it is still active. Only the call that wins emits the event, so racing ticks, a delete in flight or a second engine (dev reload, restart) can't fire it twice. If the write fails the alert goes back into the set and the next trade tries again.
- **Watchlist only:** alerts reference `watchlist.symbol` (cascade delete). Only watched symbols stream, so an alert elsewhere could never fire. Creating one for an unwatched symbol returns `not_watched` (400), detected from the foreign-key violation.
- **Event:** the hub emits `alert` `{ id, symbol, direction, price, triggerPrice, triggeredAt }` (trade time, ms epoch) to every stream. No upstream connection or provider change, so the mock provider's ticks drive it the same way (ADR 0004, 0009).
- **API:** `GET /api/alerts` lists active alerts plus those fired in the last 7 days (`RECENT_ALERT_DAYS`). `POST` with `{intent:"create", symbol, direction, price}` or `{intent:"delete", id}` answers with the updated list. It is Zod-validated and refuses cross-site requests like the other actions. The price must be 0.0001 to `MAX_ALERT_PRICE` and is rounded to the column's 4 decimals, so the in-memory target matches the stored one. The page applies a list only if it answers a newer request than the one on screen, and a delete's 404 reloads the list instead of showing an error.
- **UI:**
  - **Alerts row** under the chart: active alerts as removable chips, and "Set alert", an inline form with ▲ Above / ▼ Below and the price prefilled with the last trade. Fired alerts of the last week are listed as muted lines with a clear button.
  - **Chart:** active alerts are sparse-dotted accent price lines titled "Alert ▲"/"Alert ▼".
  - **Watchlist:** a bell beside symbols with an active alert, with screen-reader text.
  - **Fired alert:** a toast in a polite live region ("AAPL ▲ rose to 190.00 · Traded at 190.12 at 14:32 ET. The alert is now off.", Open AAPL, dismiss). There is also a browser `Notification` when permitted. Permission is asked only from the first "Create alert" click, while it is still undecided.

## Consequences

- **One-shot:** a fired alert is off for good; to watch the level again the owner sets a new one.
- **Open page needed:** the toast and notification need a Krestrel tab open (the SSE stream). Alerts that fire while no tab is open still fire and show as fired in the list for a week.
- **IEX feed:** with Alpaca's free plan, trades come from IEX only (ADR 0004), so a brief move on another venue may not reach the target here.
- **Dev servers:** the hub singleton survives hot reloads (ADR 0004), so a running dev server needs a restart to pick up the engine.
