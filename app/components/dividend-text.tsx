import { CoinsIcon } from "@phosphor-icons/react";
import {
  type DividendInfo,
  FREQUENCY_LABELS,
  PAYMENTS_PER_YEAR,
  type UpcomingDividend,
} from "~/lib/dividends";

/** Dividends per share: cents, or up to 4 decimals when that's how they're declared ($0.2715). */
const PER_SHARE = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});

const MONTH_DAY = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});
const MONTH_DAY_YEAR = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

/** "Nov 13", or "Jan 9, 2027" when not this year. Days are `YYYY-MM-DD` (New York dates). */
export function formatDay(day: string, today: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  return (day.slice(0, 4) === today.slice(0, 4) ? MONTH_DAY : MONTH_DAY_YEAR).format(date);
}

/**
 * One sentence about a payment. Coming: "Next: buy before Oct 30 (ex-dividend date), paid
 * Nov 13", plus "· expected, not yet announced" for an estimate. Pending (ex-date passed):
 * "Pays Oct 15 to holders before Sep 30 (ex-dividend date)".
 */
export function upcomingText(upcoming: UpcomingDividend, today: string): string {
  const ex = formatDay(upcoming.exDate, today);
  if (upcoming.pending) {
    const pays = upcoming.payDate ? `Pays ${formatDay(upcoming.payDate, today)}` : "Pays soon";
    return `${pays} to holders before ${ex} (ex-dividend date)`;
  }
  const paid = upcoming.payDate ? `, paid ${formatDay(upcoming.payDate, today)}` : "";
  return `Next: buy before ${ex} (ex-dividend date)${paid}${upcoming.expected ? " · expected, not yet announced" : ""}`;
}

/**
 * One-line dividend summary for the chart page and idea cards, written for someone deciding
 * whether to buy: how often it pays, how much per share (with the yearly yield at `price`), the
 * next ex-date, and a payout still on its way to current holders.
 */
export function DividendSummary({
  info,
  today,
  price,
  className = "",
}: {
  info: DividendInfo;
  today: string;
  price: number | null;
  className?: string;
}) {
  const perYear = PAYMENTS_PER_YEAR[info.frequency];
  const amount = info.next?.amount ?? info.last.amount;
  const yieldPct = perYear && price && price > 0 ? (amount * perYear * 100) / price : null;
  const pending =
    info.last.payDate && info.last.payDate >= today
      ? upcomingText({ ...info.last, expected: false, pending: true }, today)
      : null;
  return (
    <p className={`flex items-start gap-1.5 text-xs text-muted tabular-nums ${className}`}>
      <CoinsIcon aria-hidden size={14} className="mt-px shrink-0 text-accent" />
      <span className="text-pretty">
        <span className="font-medium text-text">Dividend</span> · {FREQUENCY_LABELS[info.frequency]}{" "}
        · ${PER_SHARE.format(amount)}/share
        {yieldPct !== null && ` (≈${yieldPct.toFixed(1)}% a year)`}
        {info.next && <> · {upcomingText({ ...info.next, pending: false }, today)}</>}
        {pending && (
          <>
            {" "}
            · Last one: {pending.charAt(0).toLowerCase()}
            {pending.slice(1)}
          </>
        )}
      </span>
    </p>
  );
}
