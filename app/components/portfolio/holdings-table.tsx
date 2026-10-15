import { CaretDownIcon, CaretUpDownIcon, CaretUpIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { Link } from "react-router";

import { toneOf } from "~/components/ui/styles";
import { createStoredValue } from "~/hooks/stored-value";
import type { DisplayCurrency } from "~/hooks/use-currency";
import type { Dividends } from "~/hooks/use-dividends";
import {
  type DividendInfo,
  dividendYield,
  type ExpectedPayment,
  FREQUENCY_LABELS,
} from "~/lib/dividends";
import { formatPercentChange, formatShares } from "~/lib/format";
import { IDEA_CATEGORIES, IDEA_CATEGORY_LABELS, SECTOR_SHORT, SECTORS } from "~/lib/ideas";
import type { ValuedPosition } from "~/lib/portfolio";
import type { RsiLevels, RsiSignal } from "~/lib/rsi-signal";
import {
  GROUPING_LABELS,
  groupHoldings,
  HOLDINGS_GROUPINGS,
  type HoldingsGrouping,
  type StockProfile,
} from "~/lib/stock-profile";

import { formatDay, upcomingText } from "../dividend-text";
import { RsiSignalBadge } from "../rsi-signal-badge";

/** Dividend schedules plus each holding's next payment from the portfolio tally (ADR 0022). */
export type HoldingsDividends = Dividends & { next: Readonly<Record<string, ExpectedPayment>> };

/** How the owner last grouped holdings (none, sector, type), remembered across sessions. */
export const holdingsGrouping = createStoredValue<HoldingsGrouping>(
  "krestrel.holdingsGrouping",
  "none",
  (raw) => HOLDINGS_GROUPINGS.find((grouping) => grouping === raw) ?? null,
  (value) => value,
);

/** Background tint matching each `toneOf` text colour. */
const TINT: Record<string, string> = {
  "text-rise": "bg-rise/10",
  "text-fall": "bg-fall/10",
  "text-muted": "bg-subtle",
};

/** Small signed-percent pill tinted by the sign of `value`. */
export function ChangePill({ value, fraction }: { value: number | null; fraction: number }) {
  const tone = toneOf(value);
  return (
    <span
      className={`inline-flex rounded-md px-1.5 py-0.5 text-xs font-medium tabular-nums ${tone} ${TINT[tone] ?? ""}`}
    >
      {formatPercentChange(fraction)}
    </span>
  );
}

/** Table header cell look, shared with the trade ledger. */
export const TH = "px-3 pb-2 text-xs font-medium text-muted";
const NUMERIC = "px-3 py-2.5 text-right tabular-nums";
/** A row's sector/type correction menu: reads as a quiet caption under the ticker. */
const CORRECTION_MENU =
  "block max-w-[9rem] cursor-pointer rounded bg-transparent text-xs font-normal text-muted transition-colors duration-150 hover:text-text [&>option]:bg-panel [&>option]:text-text";

type SortKey =
  | "symbol"
  | "shares"
  | "averageCost"
  | "lastPrice"
  | "marketValue"
  | "unrealized"
  | "dayChange"
  | "realized";

const COLUMNS: ReadonlyArray<{ key: SortKey; label: string }> = [
  { key: "symbol", label: "Symbol" },
  { key: "shares", label: "Shares" },
  { key: "averageCost", label: "Avg cost" },
  { key: "lastPrice", label: "Last" },
  { key: "marketValue", label: "Value" },
  { key: "unrealized", label: "Unrealized P/L" },
  { key: "dayChange", label: "Today" },
  { key: "realized", label: "Realized" },
];

/** A correction from a row's sector/type menu. */
export type Reclassify = (
  symbol: string,
  change: Partial<Pick<StockProfile, "sector" | "style">>,
) => void;

/**
 * Open positions (sortable by any column; value, largest first, by default), optionally grouped
 * by sector or type, then closed ones (realized P/L only). Amounts are converted to the display
 * currency; the symbol opens its chart.
 */
export function HoldingsTable({
  positions,
  display,
  signals,
  levels,
  grouping,
  profiles,
  onReclassify,
  dividends,
}: {
  positions: readonly ValuedPosition[];
  display: DisplayCurrency;
  /** Daily RSI signal per symbol (ADR 0014). */
  signals: Record<string, RsiSignal | null>;
  levels: RsiLevels;
  grouping: HoldingsGrouping;
  /** Sector and type per symbol (ADR 0019); missing while being classified. */
  profiles: Readonly<Record<string, StockProfile>>;
  onReclassify: Reclassify;
  /**
   * Dividend schedules (ADR 0022) and each holding's next payment from the portfolio's
   * dividend tally; undefined while loading.
   */
  dividends: HoldingsDividends | undefined;
}) {
  // Value, largest first, until the owner picks a column. Unknown values (no live price) sort last.
  const [sort, setSort] = useState<{ key: SortKey; descending: boolean }>({
    key: "marketValue",
    descending: true,
  });
  const open = positions
    .filter((position) => position.shares > 0)
    .sort((a, b) => {
      const x = a[sort.key];
      const y = b[sort.key];
      if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1;
      const order = typeof x === "string" ? x.localeCompare(String(y)) : x - Number(y);
      return sort.descending ? -order : order;
    });
  const closed = positions.filter((position) => position.shares === 0);

  const row = (position: ValuedPosition) => (
    <OpenRow
      key={position.symbol}
      position={position}
      display={display}
      signal={signals[position.symbol] ?? null}
      levels={levels}
      grouping={grouping}
      profile={profiles[position.symbol]}
      onReclassify={onReclassify}
      dividends={dividends}
    />
  );

  return (
    <div className="-mx-3 overflow-x-auto">
      <table className="w-full min-w-[60rem] border-collapse text-sm">
        <caption className="sr-only">Holdings</caption>
        <thead>
          <tr className="border-b border-rule/60">
            {COLUMNS.map(({ key, label }) => {
              const active = sort.key === key;
              const Arrow = active
                ? sort.descending
                  ? CaretDownIcon
                  : CaretUpIcon
                : CaretUpDownIcon;
              return (
                <th
                  key={key}
                  scope="col"
                  aria-sort={active ? (sort.descending ? "descending" : "ascending") : "none"}
                  className={`${TH} ${key === "symbol" ? "text-left" : "text-right"}`}
                >
                  <button
                    type="button"
                    onClick={() =>
                      // A new column starts A→Z for names and largest-first for numbers.
                      setSort(
                        active
                          ? { key, descending: !sort.descending }
                          : { key, descending: key !== "symbol" },
                      )
                    }
                    className={`inline-flex items-center gap-1 rounded-md transition-colors duration-150 hover:text-text ${
                      active ? "text-text" : ""
                    }`}
                  >
                    {label}
                    <Arrow
                      aria-hidden
                      size={11}
                      weight="bold"
                      className={active ? "text-accent" : "opacity-40"}
                    />
                  </button>
                </th>
              );
            })}
            <th
              scope="col"
              className={`${TH} text-left`}
              title={`Daily RSI(14) with your levels ${levels.oversold}/${levels.overbought}. A momentum rule of thumb, not financial advice.`}
            >
              Signal
            </th>
            <th
              scope="col"
              className={`${TH} text-right`}
              title="Next dividend payment and the cash it brings for your shares (before tax). From the market data provider; 'expected' dates are estimated from the usual schedule."
            >
              Next dividend
            </th>
          </tr>
        </thead>
        {grouping === "none" ? (
          <tbody className="divide-y divide-rule/60">{open.map(row)}</tbody>
        ) : (
          groupHoldings(open, profiles, grouping).map((group) => (
            <tbody key={group.key ?? "none"} className="divide-y divide-rule/60">
              <tr className="bg-subtle/60">
                <th
                  scope="rowgroup"
                  colSpan={10}
                  className="px-3 py-2 text-left text-xs font-semibold text-text"
                >
                  {group.label}
                  <span className="ml-2 font-normal text-muted tabular-nums">
                    {group.positions.length} {group.positions.length === 1 ? "holding" : "holdings"}{" "}
                    · {display.money(group.marketValue)} ·{" "}
                    {(group.weight * 100).toFixed(group.weight < 0.1 ? 1 : 0)}% of value
                  </span>
                </th>
              </tr>
              {group.positions.map(row)}
            </tbody>
          ))
        )}
        {closed.length > 0 && (
          <tbody className="divide-y divide-rule/60 text-muted">
            <tr>
              <th scope="rowgroup" colSpan={10} className={`${TH} pt-6 text-left`}>
                Closed positions
              </th>
            </tr>
            {closed.map((position) => (
              <tr key={position.symbol} className="transition-colors duration-150 hover:bg-subtle">
                <th scope="row" className="px-3 py-2.5 text-left">
                  <Link
                    to={`/?symbol=${position.symbol}`}
                    className="font-medium tracking-tight transition-colors duration-150 hover:text-accent"
                  >
                    {position.symbol}
                  </Link>
                </th>
                <td className={NUMERIC}>0</td>
                <td className={NUMERIC} colSpan={5} />
                <td className={`${NUMERIC} ${toneOf(position.realized)}`}>
                  {display.money(position.realized, true)}
                </td>
                <td />
                <td />
              </tr>
            ))}
          </tbody>
        )}
      </table>
    </div>
  );
}

/** Segmented "Group: None · Sector · Type" control for the Holdings header. */
export function GroupingControl({
  value,
  onChange,
}: {
  value: HoldingsGrouping;
  onChange: (value: HoldingsGrouping) => void;
}) {
  return (
    <fieldset className="inline-flex h-7 items-center gap-0.5 rounded-lg bg-subtle p-0.5 text-xs">
      <legend className="sr-only">Group holdings by</legend>
      <span aria-hidden className="px-1.5 text-muted">
        Group
      </span>
      {HOLDINGS_GROUPINGS.map((option) => (
        <label
          key={option}
          className={`inline-flex h-full cursor-pointer items-center rounded-md px-2 font-medium transition-colors duration-150 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent/60 ${
            value === option ? "bg-panel text-text shadow-sm" : "text-muted hover:text-text"
          }`}
        >
          <input
            type="radio"
            name="holdings-grouping"
            value={option}
            checked={value === option}
            onChange={() => onChange(option)}
            className="sr-only"
          />
          {GROUPING_LABELS[option]}
        </label>
      ))}
    </fieldset>
  );
}

function OpenRow({
  position,
  display,
  signal,
  levels,
  grouping,
  profile,
  onReclassify,
  dividends,
}: {
  position: ValuedPosition;
  display: DisplayCurrency;
  signal: RsiSignal | null;
  levels: RsiLevels;
  grouping: HoldingsGrouping;
  profile: StockProfile | undefined;
  onReclassify: Reclassify;
  dividends: HoldingsDividends | undefined;
}) {
  const { symbol } = position;
  return (
    <tr className="transition-colors duration-150 hover:bg-subtle">
      <th scope="row" className="px-3 py-2.5 text-left">
        <Link
          to={`/?symbol=${symbol}`}
          className="font-semibold tracking-tight text-text transition-colors duration-150 hover:text-accent"
        >
          {symbol}
        </Link>
        {/* Corrections: the owner's choice wins over the model from then on. */}
        {grouping === "sector" && (
          <select
            aria-label={`${symbol} sector`}
            value={profile?.sector ?? ""}
            onChange={(event) =>
              onReclassify(symbol, {
                sector: SECTORS.find((sector) => sector === event.target.value) ?? null,
              })
            }
            className={CORRECTION_MENU}
          >
            <option value="">Fund / other</option>
            {SECTORS.map((sector) => (
              <option key={sector} value={sector}>
                {SECTOR_SHORT[sector]}
              </option>
            ))}
          </select>
        )}
        {grouping === "style" && (
          <select
            aria-label={`${symbol} type`}
            value={profile?.style ?? ""}
            onChange={(event) =>
              onReclassify(symbol, {
                style: IDEA_CATEGORIES.find((style) => style === event.target.value) ?? null,
              })
            }
            className={CORRECTION_MENU}
          >
            <option value="" disabled>
              Unclassified
            </option>
            {IDEA_CATEGORIES.map((style) => (
              <option key={style} value={style}>
                {IDEA_CATEGORY_LABELS[style].name}
              </option>
            ))}
          </select>
        )}
      </th>
      <td className={`${NUMERIC} text-text`}>{formatShares(position.shares)}</td>
      <td className={`${NUMERIC} text-muted`}>
        {position.averageCost === null ? "—" : display.money(position.averageCost)}
      </td>
      <td className={`${NUMERIC} text-text`}>
        {position.lastPrice === null ? (
          <span title="No live price: the symbol isn't on your watchlist or hasn't traded yet.">
            —
          </span>
        ) : (
          display.money(position.lastPrice)
        )}
      </td>
      <td className={`${NUMERIC} font-medium text-text`}>
        {position.marketValue === null ? "—" : display.money(position.marketValue)}
      </td>
      <td className={`${NUMERIC} ${toneOf(position.unrealized)}`}>
        {position.unrealized === null ? (
          "—"
        ) : (
          <span className="inline-flex items-center justify-end gap-2">
            {display.money(position.unrealized, true)}
            {position.unrealizedFraction !== null && (
              <ChangePill value={position.unrealized} fraction={position.unrealizedFraction} />
            )}
          </span>
        )}
      </td>
      <td className={`${NUMERIC} ${toneOf(position.dayChange)}`}>
        {position.dayChange === null ? "—" : display.money(position.dayChange, true)}
      </td>
      <td className={`${NUMERIC} ${toneOf(position.realized)}`}>
        {position.realized === 0 ? "—" : display.money(position.realized, true)}
      </td>
      <td className="px-3 py-2.5">
        <RsiSignalBadge signal={signal} levels={levels} compact />
      </td>
      <td className={NUMERIC}>
        <DividendCell
          info={dividends?.bySymbol[symbol]}
          payment={dividends?.next[symbol]}
          today={dividends?.today ?? ""}
          price={position.lastPrice}
          display={display}
        />
      </td>
    </tr>
  );
}

/**
 * Next payment date and the cash it brings ("—" without a dividend). A payout whose ex-date has
 * passed counts only shares held before it, so it may be skipped for a recent buy.
 */
function DividendCell({
  info,
  payment,
  today,
  price,
  display,
}: {
  /** undefined: not known yet (loading or provider unavailable); null: no regular dividend. */
  info: DividendInfo | null | undefined;
  payment: ExpectedPayment | undefined;
  today: string;
  /** Live price for the yield; null without one. */
  price: number | null;
  display: DisplayCurrency;
}) {
  if (info === undefined) return <span className="text-muted">…</span>;
  if (!info || !payment) {
    return (
      <span
        className="text-muted"
        title={info ? FREQUENCY_LABELS[info.frequency] : "No regular dividend"}
      >
        —
      </span>
    );
  }
  const yieldPct = dividendYield(info, price);
  const tip = [
    `${FREQUENCY_LABELS[info.frequency]}, ${display.money(payment.amount)} a share${yieldPct === null ? "" : ` (≈${yieldPct.toFixed(1)}% a year at the last price)`}.`,
    `${upcomingText(payment, today)}.`,
    payment.pending
      ? `Paid on the ${formatShares(payment.shares)} shares you held before the ex-dividend date.`
      : "Hold the shares on the ex-dividend date to get it.",
  ].join(" ");
  return (
    <span className="inline-grid justify-items-end leading-tight" title={tip}>
      <span className="text-text">
        {formatDay(payment.payDate ?? payment.exDate, today)}
        {payment.expected && <span className="ml-1 text-xs text-muted">expected</span>}
      </span>
      <span className="text-xs text-muted">
        {display.money(payment.cash)}
        {yieldPct !== null && ` · ${yieldPct.toFixed(1)}%`}
      </span>
    </span>
  );
}
