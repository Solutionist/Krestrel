// AlertEngine (ADR 0023): checks every live trade against the owner's price alerts. The active set
// lives in memory so the per-tick check is a map lookup; the database decides what fires, so an
// alert fires exactly once even when ticks race each other or the server restarts.
import type { Logger } from "pino";

import { ALERT_MET, type AlertFired, type PriceAlert, RECENT_ALERT_DAYS } from "~/lib/alerts";
import type { Database } from "./db/client";
import {
  type Alert,
  type AlertDirection,
  createAlert,
  deleteAlert,
  listActiveAlerts,
  listRecentAlerts,
  markAlertTriggered,
} from "./db/queries/alerts";

const DAY = 24 * 60 * 60_000;

export type CreateAlertResult =
  | { ok: true; alert: PriceAlert }
  | { ok: false; code: "not_watched"; message: string };

export interface AlertEngineDeps {
  db: Database;
  logger: Logger;
  /** Called once per fired alert; the hub sends it to every stream as an `alert` event. */
  emit: (fired: AlertFired) => void;
  now?: () => number;
}

export class AlertEngine {
  readonly #db: Database;
  readonly #log: Logger;
  readonly #emit: (fired: AlertFired) => void;
  readonly #now: () => number;
  /** Active alerts by symbol, then id. */
  readonly #active = new Map<string, Map<string, Alert>>();
  /** Triggers waiting on the database. */
  readonly #pending = new Set<Promise<void>>();

  constructor(deps: AlertEngineDeps) {
    this.#db = deps.db;
    this.#log = deps.logger;
    this.#emit = deps.emit;
    this.#now = deps.now ?? Date.now;
  }

  /** Loads the active alerts from the database. Adds to what `create` already tracked. */
  async load(): Promise<void> {
    const alerts = await listActiveAlerts(this.#db);
    for (const alert of alerts) this.#track(alert);
    this.#log.info({ alerts: alerts.length }, "alerts loaded");
  }

  /**
   * Checks a trade for `symbol`. A reached alert leaves the active set at once, so later ticks
   * don't try it again; the database's conditional update then decides whether it fires.
   */
  onPrice(symbol: string, price: number, ts: number): void {
    const alerts = this.#active.get(symbol);
    if (!alerts) return;
    for (const alert of alerts.values()) {
      if (!ALERT_MET[alert.direction](price, alert.price)) continue;
      alerts.delete(alert.id);
      this.#trigger(alert, price, ts);
    }
    if (alerts.size === 0) this.#active.delete(symbol);
  }

  async create(input: {
    symbol: string;
    direction: AlertDirection;
    price: number;
  }): Promise<CreateAlertResult> {
    const alert = await createAlert(this.#db, input);
    if (!alert) {
      return {
        ok: false,
        code: "not_watched",
        message: `${input.symbol} isn't on your watchlist. Add it first, then set the alert.`,
      };
    }
    this.#track(alert);
    this.#log.info({ id: alert.id, symbol: alert.symbol }, "alert created");
    return { ok: true, alert: toPriceAlert(alert) };
  }

  /** Removes an alert, active or fired. False when it no longer exists. */
  async delete(id: string): Promise<boolean> {
    const removed = await deleteAlert(this.#db, id);
    for (const [symbol, alerts] of this.#active) {
      if (alerts.delete(id) && alerts.size === 0) this.#active.delete(symbol);
    }
    return removed;
  }

  /** Drops a symbol's active alerts after the watchlist removal deleted their rows. */
  forgetSymbol(symbol: string): void {
    this.#active.delete(symbol);
  }

  /** Active alerts plus those fired in the last `RECENT_ALERT_DAYS`, newest first. */
  async list(): Promise<PriceAlert[]> {
    const since = new Date(this.#now() - RECENT_ALERT_DAYS * DAY);
    return (await listRecentAlerts(this.#db, since)).map(toPriceAlert);
  }

  /** Resolves once every trigger in flight has been written (and emitted). */
  async settled(): Promise<void> {
    await Promise.all(this.#pending);
  }

  #track(alert: Alert): void {
    let alerts = this.#active.get(alert.symbol);
    if (!alerts) {
      alerts = new Map();
      this.#active.set(alert.symbol, alerts);
    }
    alerts.set(alert.id, alert);
  }

  #trigger(alert: Alert, price: number, ts: number): void {
    const pending = markAlertTriggered(this.#db, alert.id, price, new Date(ts))
      .then((fired) => {
        // Null: deleted, or already fired (another tick, or before a restart).
        if (!fired) return;
        this.#log.info({ id: fired.id, symbol: fired.symbol, price }, "alert fired");
        this.#emit({
          id: fired.id,
          symbol: fired.symbol,
          direction: fired.direction,
          price: fired.price,
          triggerPrice: fired.triggerPrice ?? price,
          triggeredAt: ts,
        });
      })
      .catch((err: unknown) => {
        // Still active in the database: the next trade tries again.
        this.#log.error({ err, id: alert.id }, "alert trigger failed");
        this.#track(alert);
      })
      .finally(() => this.#pending.delete(pending));
    this.#pending.add(pending);
  }
}

function toPriceAlert(alert: Alert): PriceAlert {
  return {
    id: alert.id,
    symbol: alert.symbol,
    direction: alert.direction,
    price: alert.price,
    active: alert.active,
    createdAt: alert.createdAt.getTime(),
    triggeredAt: alert.triggeredAt?.getTime() ?? null,
    triggerPrice: alert.triggerPrice,
  };
}
