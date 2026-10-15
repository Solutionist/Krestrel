import { BellRingingIcon, XIcon } from "@phosphor-icons/react";

import { Button, IconButton } from "~/components/ui/button";
import { POPOVER } from "~/components/ui/styles";
import { type AlertFired, describeFiredAlert } from "~/lib/alerts";

/**
 * Fired price alerts (ADR 0023) as toasts in the bottom-right corner, until dismissed. The region
 * is always mounted so screen readers announce each new alert (polite; ai/ui.md allows live
 * regions for fired alerts).
 */
export function AlertToasts({
  fired,
  onDismiss,
  onOpen,
}: {
  fired: readonly AlertFired[];
  onDismiss: (id: string) => void;
  /** Opens the alert's chart. */
  onOpen: (symbol: string) => void;
}) {
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed right-4 bottom-4 z-40 flex w-80 flex-col gap-2"
    >
      {fired.map((alert) => {
        const { title, body } = describeFiredAlert(alert);
        return (
          <div
            key={alert.id}
            className={`${POPOVER} pointer-events-auto flex items-start gap-2.5 p-3 text-sm`}
          >
            <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-accent/10 text-accent">
              <BellRingingIcon aria-hidden size={15} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-semibold tracking-tight text-text tabular-nums">{title}</p>
              <p className="mt-0.5 text-xs text-muted tabular-nums">{body}</p>
              <Button
                size="sm"
                variant="ghost"
                className="-ml-2.5 mt-1"
                onClick={() => {
                  onOpen(alert.symbol);
                  onDismiss(alert.id);
                }}
              >
                Open {alert.symbol}
              </Button>
            </div>
            <IconButton label={`Dismiss ${alert.symbol} alert`} onClick={() => onDismiss(alert.id)}>
              <XIcon aria-hidden size={14} />
            </IconButton>
          </div>
        );
      })}
    </div>
  );
}
