import { formatPercentChange, formatPrice } from "~/lib/format";

/** A price on a plan, with why it sits there when known (e.g. "S1 support"). */
export interface PlanPoint {
  price: number;
  basis?: string;
}

/** Signed distance from the last price, e.g. "−2.10%". */
function fromLast(price: number, last: number | null): string | null {
  return last === null || last <= 0 ? null : formatPercentChange(price / last - 1);
}

function Row({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="grid grid-cols-[4.5rem_1fr] gap-x-2 py-1.5">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="min-w-0">
        <span className="text-text tabular-nums">{value}</span>
        {detail && <span className="block text-xs text-muted tabular-nums">{detail}</span>}
      </dd>
    </div>
  );
}

const details = (...parts: (string | null | undefined)[]) => parts.filter(Boolean).join(" · ");

/**
 * Buy zone, stop and targets with their distance from the last price: the same rows for the local
 * plan (Insights) and Claude's plan (AI outlook), so both read alike.
 */
export function PlanLevels({
  lastPrice,
  buyZone,
  stop,
  targets,
  noZone,
}: {
  lastPrice: number | null;
  buyZone: { low: number; high: number; basis?: string } | null;
  stop: PlanPoint | null;
  targets: readonly PlanPoint[];
  /** Shown in place of the buy zone when there is none. */
  noZone: string;
}) {
  const inZone =
    buyZone !== null && lastPrice !== null && lastPrice >= buyZone.low && lastPrice <= buyZone.high;
  return (
    <dl className="divide-y divide-rule/60 text-sm">
      {buyZone ? (
        <Row
          label="Buy zone"
          value={`${formatPrice(buyZone.low)} – ${formatPrice(buyZone.high)}`}
          detail={details(
            inZone ? "at the price" : fromLast(buyZone.high, lastPrice),
            buyZone.basis,
          )}
        />
      ) : (
        <div className="grid grid-cols-[4.5rem_1fr] gap-x-2 py-1.5">
          <dt className="text-xs text-muted">Buy zone</dt>
          <dd className="text-xs text-pretty text-muted">{noZone}</dd>
        </div>
      )}
      {stop && (
        <Row
          label="Stop"
          value={formatPrice(stop.price)}
          detail={details(fromLast(stop.price, lastPrice), stop.basis)}
        />
      )}
      {targets.map((target, index) => (
        <Row
          key={target.price}
          label={targets.length > 1 ? `Target ${index + 1}` : "Target"}
          value={formatPrice(target.price)}
          detail={details(fromLast(target.price, lastPrice), target.basis)}
        />
      ))}
    </dl>
  );
}
