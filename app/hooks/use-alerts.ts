import { useCallback, useEffect, useRef, useState } from "react";

import {
  type AlertAction,
  type AlertFired,
  AlertsResponseSchema,
  describeFiredAlert,
  type PriceAlert,
} from "~/lib/alerts";

import type { AlertListener, LinkState } from "./use-market-stream";

/** Fired-alert toasts kept on screen at once (newest last). */
const MAX_TOASTS = 3;

export interface AlertsState {
  /** Active alerts and those fired in the last week, newest first; undefined while loading. */
  alerts: PriceAlert[] | undefined;
  /** The last request's failure, in words for the page. */
  error: string | null;
  /** Fired alerts not yet dismissed, newest last. */
  fired: AlertFired[];
  /** True when saved. Asks for notification permission on the first call (a user click). */
  create: (input: Omit<Extract<AlertAction, { intent: "create" }>, "intent">) => Promise<boolean>;
  remove: (id: string) => Promise<void>;
  dismiss: (id: string) => void;
}

/**
 * Price alerts for the Markets page (ADR 0023): the list from `/api/alerts`, create and delete,
 * and fired alerts from the SSE `alert` event as toasts plus a browser notification when allowed.
 * Reloads when the watchlist changes (removing a symbol deletes its alerts) and on reconnect.
 */
export function useAlerts({
  onAlert,
  watchlist,
  link,
}: {
  onAlert: (listener: AlertListener) => () => void;
  watchlist: readonly string[];
  link: LinkState;
}): AlertsState {
  const [alerts, setAlerts] = useState<PriceAlert[] | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [fired, setFired] = useState<AlertFired[]>([]);
  /** Latest request number sent: only its failure is shown. */
  const sent = useRef(0);
  /** Request number of the list on screen: an older answer never overwrites a newer one. */
  const applied = useRef(0);

  const request = useCallback(async (init?: RequestInit): Promise<boolean> => {
    const id = ++sent.current;
    try {
      const response = await fetch("/api/alerts", init);
      const parsed = AlertsResponseSchema.safeParse(await response.json());
      if (!parsed.success) {
        if (id === sent.current) setError("Krestrel sent an unexpected answer. Reload the page.");
        return false;
      }
      const answer = parsed.data;
      if (answer.ok) {
        if (id > applied.current) {
          applied.current = id;
          setAlerts(answer.alerts);
          setError(null);
        }
        return true;
      }
      if (answer.error.code === "not_found") {
        // Already gone (a double-clicked ×): the fresh list says so better than an error.
        void request();
        return false;
      }
      if (id === sent.current) setError(answer.error.message);
      return false;
    } catch {
      if (id === sent.current) setError("Couldn't reach the Krestrel server. Try again.");
      return false;
    }
  }, []);

  const watchlistKey = watchlist.join(",");
  // biome-ignore lint/correctness/useExhaustiveDependencies: watchlistKey is a reload trigger (removing a symbol deletes its alerts).
  useEffect(() => {
    if (link !== "lost") void request();
  }, [request, watchlistKey, link]);

  useEffect(
    () =>
      onAlert((alert) => {
        setFired((current) =>
          [...current.filter((entry) => entry.id !== alert.id), alert].slice(-MAX_TOASTS),
        );
        if (typeof Notification !== "undefined" && Notification.permission === "granted") {
          const { title, body } = describeFiredAlert(alert);
          // Shown for its side effect; the tag keeps a repeat from stacking a second notice.
          new Notification(title, { body, tag: alert.id });
        }
        void request();
      }),
    [onAlert, request],
  );

  const post = useCallback(
    (action: AlertAction) =>
      request({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action),
      }),
    [request],
  );

  const create = useCallback<AlertsState["create"]>(
    (input) => {
      // Only ever asked from this click, and only once: after that the permission isn't "default".
      if (typeof Notification !== "undefined" && Notification.permission === "default") {
        void Notification.requestPermission();
      }
      return post({ intent: "create", ...input });
    },
    [post],
  );

  const remove = useCallback(
    async (id: string) => {
      await post({ intent: "delete", id });
    },
    [post],
  );

  const dismiss = useCallback(
    (id: string) => setFired((current) => current.filter((entry) => entry.id !== id)),
    [],
  );

  return { alerts, error, fired, create, remove, dismiss };
}
