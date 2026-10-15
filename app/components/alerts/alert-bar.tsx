import { BellSimpleIcon, CheckIcon, PlusIcon, XIcon } from "@phosphor-icons/react";
import { type FormEvent, useEffect, useId, useRef, useState } from "react";

import { Button, IconButton } from "~/components/ui/button";
import { Segmented } from "~/components/ui/segmented";
import { FIELD, HEADING } from "~/components/ui/styles";
import {
  ALERT_MET,
  type AlertDirection,
  MAX_ALERT_PRICE,
  MIN_ALERT_PRICE,
  type PriceAlert,
} from "~/lib/alerts";
import { formatExchangeShort } from "~/lib/candles";
import { formatPercentChange, formatPrice } from "~/lib/format";

const DIRECTION_LABEL: Record<AlertDirection, string> = { above: "▲ Above", below: "▼ Below" };

const DIRECTION_OPTIONS = [
  { value: "above", label: DIRECTION_LABEL.above, ariaLabel: "Price rises to or above" },
  { value: "below", label: DIRECTION_LABEL.below, ariaLabel: "Price falls to or below" },
] as const;

/**
 * Price alerts for the open symbol (ADR 0023), under the chart: active alerts as removable chips,
 * "Set alert" (above/below, prefilled with the last price), and alerts fired in the last week.
 */
export function AlertBar({
  symbol,
  lastPrice,
  alerts,
  error,
  onCreate,
  onRemove,
}: {
  symbol: string;
  lastPrice: number | null;
  /** This symbol's alerts: active and recently fired. */
  alerts: readonly PriceAlert[];
  error: string | null;
  onCreate: (input: {
    symbol: string;
    direction: AlertDirection;
    price: number;
  }) => Promise<boolean>;
  onRemove: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [direction, setDirection] = useState<AlertDirection>("above");
  const [priceText, setPriceText] = useState("");
  const [saving, setSaving] = useState(false);
  const inputId = useId();
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) input.current?.select();
  }, [editing]);

  const active = alerts.filter((alert) => alert.active);
  const fired = alerts.filter((alert) => !alert.active);
  const price = Number(priceText);
  const valid = priceText.trim() !== "" && price >= MIN_ALERT_PRICE && price <= MAX_ALERT_PRICE;

  let hint = "";
  if (valid && lastPrice !== null && lastPrice > 0) {
    hint = ALERT_MET[direction](lastPrice, price)
      ? `The price is already ${direction} this, so it fires on the next trade.`
      : `${formatPercentChange(price / lastPrice - 1)} from the last price.`;
  }

  const open = () => {
    setDirection("above");
    setPriceText(lastPrice === null ? "" : String(lastPrice));
    setEditing(true);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!valid || saving) return;
    setSaving(true);
    const saved = await onCreate({ symbol, direction, price });
    setSaving(false);
    if (saved) setEditing(false);
  };

  return (
    <section
      aria-label={`Price alerts for ${symbol}`}
      className="border-t border-rule/60 px-5 py-2"
    >
      <div className="flex min-h-7 flex-wrap items-center gap-x-2 gap-y-1.5">
        <BellSimpleIcon aria-hidden size={15} className="text-muted" />
        <h2 className={HEADING}>Alerts</h2>
        {active.length === 0 && !editing && (
          <span className="text-xs text-muted">None set for {symbol}</span>
        )}
        {active.map((alert) => (
          <span
            key={alert.id}
            className="inline-flex items-center rounded-md bg-accent/10 pl-2 text-xs font-medium text-accent ring-1 ring-inset ring-accent/20"
          >
            <span className="tabular-nums">
              {DIRECTION_LABEL[alert.direction]} {formatPrice(alert.price)}
            </span>
            <IconButton
              label={`Remove alert ${alert.direction} ${formatPrice(alert.price)}`}
              onClick={() => onRemove(alert.id)}
              className="text-accent hover:text-text"
            >
              <XIcon aria-hidden size={12} />
            </IconButton>
          </span>
        ))}
        {!editing && (
          <Button size="sm" variant="ghost" onClick={open}>
            <PlusIcon aria-hidden size={14} />
            Set alert
          </Button>
        )}
      </div>

      {editing && (
        <form
          onSubmit={submit}
          onKeyDown={(event) => {
            if (event.key === "Escape") setEditing(false);
          }}
          className="mt-2 flex flex-wrap items-center gap-2"
        >
          <Segmented
            label="Alert when the price"
            options={DIRECTION_OPTIONS}
            value={direction}
            onChange={setDirection}
          />
          <label htmlFor={inputId} className="sr-only">
            Alert price in US dollars
          </label>
          <input
            ref={input}
            id={inputId}
            type="number"
            inputMode="decimal"
            step="any"
            min="0"
            value={priceText}
            onChange={(event) => setPriceText(event.target.value)}
            className={`${FIELD} h-7 w-28 tabular-nums`}
          />
          <Button type="submit" variant="primary" size="sm" disabled={!valid || saving}>
            {saving ? "Saving…" : "Create alert"}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
            Cancel
          </Button>
          {hint && <span className="text-xs text-muted tabular-nums">{hint}</span>}
        </form>
      )}

      {fired.length > 0 && (
        <ul className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
          {fired.map((alert) => (
            <li key={alert.id} className="inline-flex items-center gap-1 tabular-nums">
              <CheckIcon aria-hidden size={12} />
              Fired: {alert.direction} {formatPrice(alert.price)}, traded at{" "}
              {alert.triggerPrice === null ? "—" : formatPrice(alert.triggerPrice)}
              {alert.triggeredAt !== null &&
                ` on ${formatExchangeShort(alert.triggeredAt, true)} ET`}
              <IconButton
                label={`Clear fired alert ${alert.direction} ${formatPrice(alert.price)}`}
                onClick={() => onRemove(alert.id)}
              >
                <XIcon aria-hidden size={12} />
              </IconButton>
            </li>
          ))}
        </ul>
      )}

      <p aria-live="polite" className="text-xs text-fall">
        {error}
      </p>
    </section>
  );
}
