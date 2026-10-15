import {
  ArrowCounterClockwiseIcon,
  CalendarDotsIcon,
  CoinsIcon,
  PencilSimpleIcon,
  WarningCircleIcon,
  XIcon,
} from "@phosphor-icons/react";
import { type FormEvent, useId, useState } from "react";

import { Button, IconButton } from "~/components/ui/button";
import { FIELD, HEADING, LABEL } from "~/components/ui/styles";
import type { DisplayCurrency } from "~/hooks/use-currency";
import type { Dividends } from "~/hooks/use-dividends";
import type { DividendsReceivedState } from "~/hooks/use-dividends-received";
import { nyDay } from "~/lib/candles";
import { dividendCalendar } from "~/lib/dividend-calendar";
import {
  DividendOverrideSchema,
  type ReceivedDividend,
  receivedByYear,
  receivedSummary,
} from "~/lib/dividends-received";
import { formatShares } from "~/lib/format";
import type { Trade, ValuedPosition } from "~/lib/portfolio";

import { formatDay } from "../dividend-text";
import { TH } from "./holdings-table";

const CALENDAR_MONTHS = 12;
/** Most recent payments listed before "Show all". */
const RECENT_ROWS = 12;
const CELL = "px-3 py-2";
const NUMERIC = `${CELL} text-right tabular-nums`;
const MONTH_LABEL = new Intl.DateTimeFormat("en-US", {
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

/**
 * Dividends tab (ADR 0025): what the portfolios in view have received since their first trade
 * (worked out per payout, editable to the broker's exact amount), then a 12-month calendar of the
 * payments current holdings are expected to bring.
 */
export function DividendsPanel({
  portfolioId,
  portfolios,
  positions,
  trades,
  dividends,
  received,
  display,
}: {
  /** null: all portfolios, each row then names its portfolio. */
  portfolioId: string | null;
  portfolios: ReadonlyArray<{ id: string; name: string }>;
  positions: readonly ValuedPosition[];
  trades: readonly Trade[];
  dividends: Dividends | undefined;
  received: DividendsReceivedState;
  display: DisplayCurrency;
}) {
  const today = dividends?.today ?? nyDay(Date.now());
  const names = portfolioId
    ? null
    : Object.fromEntries(portfolios.map((portfolio) => [portfolio.id, portfolio.name]));
  return (
    <div className="grid gap-8">
      <ReceivedSection state={received} names={names} today={today} display={display} />
      <CalendarSection
        positions={positions}
        trades={trades}
        dividends={dividends}
        withholding={received.withholding}
        display={display}
      />
    </div>
  );
}

function ReceivedSection({
  state,
  names,
  today,
  display,
}: {
  state: DividendsReceivedState;
  names: Record<string, string> | null;
  today: string;
  display: DisplayCurrency;
}) {
  const [showAll, setShowAll] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const { received, error } = state;
  const summary = received ? receivedSummary(received, today) : null;
  const years = received ? receivedByYear(received) : [];
  const newestFirst = received ? [...received].reverse() : [];
  const rows = showAll ? newestFirst : newestFirst.slice(0, RECENT_ROWS);
  const year = Number(today.slice(0, 4));

  return (
    <section aria-labelledby="received-heading" className="grid gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <h2 id="received-heading" className={`${HEADING} flex items-center gap-1.5`}>
          <CoinsIcon aria-hidden size={16} className="text-accent" />
          Dividends received
        </h2>
        <span className="text-xs text-muted">Since your first trade, paid in USD</span>
      </div>

      {error && (
        <p role="alert" className="flex items-center gap-1.5 text-xs text-fall">
          <WarningCircleIcon aria-hidden size={14} className="shrink-0" />
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
        {summary ? (
          <dl className="flex flex-wrap gap-x-8 gap-y-3">
            <Total label={`This year (${year})`} value={display.money(summary.thisYear)} />
            <Total label={`Last year (${year - 1})`} value={display.money(summary.lastYear)} />
            <Total label="All time" value={display.money(summary.allTime)} />
          </dl>
        ) : (
          !error && <p className="text-sm text-muted">Loading dividend history…</p>
        )}
        <WithholdingField value={state.withholding} onChange={state.setWithholding} />
      </div>

      {years.length > 2 && (
        <p className="text-xs text-muted tabular-nums">
          By year: {years.map((entry) => `${entry.year} ${display.money(entry.cash)}`).join(" · ")}
        </p>
      )}

      {received && received.length === 0 && (
        <p className="rounded-xl bg-subtle/60 p-4 text-sm text-muted">
          No dividends received yet. Payments show up here once a stock you held before its
          ex-dividend date has paid.
        </p>
      )}

      {rows.length > 0 && (
        <div className="-mx-3 overflow-x-auto">
          <table className="w-full min-w-[36rem] border-collapse text-sm">
            <caption className="sr-only">Dividends received, newest first</caption>
            <thead>
              <tr className="border-b border-rule/60">
                <th scope="col" className={`${TH} text-left`}>
                  Paid
                </th>
                <th scope="col" className={`${TH} text-left`}>
                  Stock
                </th>
                {names && (
                  <th scope="col" className={`${TH} text-left`}>
                    Portfolio
                  </th>
                )}
                <th scope="col" className={`${TH} text-right`}>
                  Shares × per share
                </th>
                <th scope="col" className={`${TH} text-right`}>
                  Cash
                </th>
                <th scope="col" className={TH}>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-rule/60">
              {rows.map((payment) => {
                const id = `${payment.portfolioId} ${payment.symbol} ${payment.exDate}`;
                return (
                  <PaymentRow
                    key={id}
                    payment={payment}
                    portfolioName={names ? (names[payment.portfolioId] ?? "") : null}
                    today={today}
                    display={display}
                    editing={editing === id}
                    onEdit={(open) => setEditing(open ? id : null)}
                    onSave={(amount) => {
                      state.setOverride(
                        {
                          portfolioId: payment.portfolioId,
                          symbol: payment.symbol,
                          exDate: payment.exDate,
                        },
                        amount,
                      );
                      setEditing(null);
                    }}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {received && received.length > RECENT_ROWS && (
        <Button
          variant="ghost"
          size="sm"
          className="justify-self-start"
          onClick={() => setShowAll(!showAll)}
        >
          {showAll ? "Show recent only" : `Show all ${received.length} payments`}
        </Button>
      )}

      {received && received.length > 0 && (
        <p className="text-xs text-muted">
          Each amount is the payout per share × the shares you held before its ex-dividend date,
          less your withholding rate. Edit a payment to enter the exact amount your broker paid; an
          edited amount ignores the rate.
        </p>
      )}
    </section>
  );
}

function Total({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-0.5">
      <dt className={LABEL}>{label}</dt>
      <dd className="text-lg font-semibold tracking-tight text-text tabular-nums">{value}</dd>
    </div>
  );
}

/** Withholding rate, applied as typed; an invalid entry is marked and reverts on leaving. */
function WithholdingField({
  value,
  onChange,
}: {
  value: number;
  onChange: (percent: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const percent = Number(draft);
  // NaN fails both comparisons.
  const invalid = draft !== null && (draft.trim() === "" || !(percent >= 0 && percent <= 100));
  return (
    <div className="grid max-w-xs gap-1">
      <label htmlFor="dividend-withholding" className={LABEL}>
        Tax withheld at source
      </label>
      <span className="flex items-center gap-1.5">
        <input
          id="dividend-withholding"
          type="number"
          inputMode="decimal"
          min={0}
          max={100}
          step="any"
          value={draft ?? String(value)}
          aria-invalid={invalid}
          aria-describedby="dividend-withholding-hint"
          onChange={(event) => {
            const raw = event.target.value;
            setDraft(raw);
            const percent = Number(raw);
            if (raw.trim() !== "" && percent >= 0 && percent <= 100) onChange(percent);
          }}
          onBlur={() => setDraft(null)}
          className={`${FIELD} h-8 w-20 text-right tabular-nums aria-invalid:ring-fall`}
        />
        <span className="text-sm text-muted">%</span>
      </span>
      <p id="dividend-withholding-hint" className="text-xs text-muted">
        US dividends are usually taxed at source; enter your rate to see cash after tax.
      </p>
    </div>
  );
}

function PaymentRow({
  payment,
  portfolioName,
  today,
  display,
  editing,
  onEdit,
  onSave,
}: {
  payment: ReceivedDividend;
  portfolioName: string | null;
  today: string;
  display: DisplayCurrency;
  editing: boolean;
  onEdit: (open: boolean) => void;
  /** USD received, or null to go back to the worked-out amount. */
  onSave: (amount: number | null) => void;
}) {
  const [draft, setDraft] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const inputId = useId();
  const what = `${payment.symbol} dividend paid ${formatDay(payment.payDate ?? payment.exDate, today)}`;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const amount = DividendOverrideSchema.shape.amount.safeParse(
      draft.trim() === "" ? Number.NaN : Number(draft),
    );
    if (!amount.success) {
      setProblem("Enter the amount received in USD, 0 or more.");
      return;
    }
    onSave(amount.data);
  }

  return (
    <tr
      className={`group transition-colors duration-150 ${editing ? "bg-accent/8" : "hover:bg-subtle"}`}
    >
      <td className={`${CELL} text-muted tabular-nums`}>
        {formatDay(payment.payDate ?? payment.exDate, today)}
      </td>
      <td className={`${CELL} font-semibold tracking-tight text-text`}>{payment.symbol}</td>
      {portfolioName !== null && <td className={`${CELL} text-muted`}>{portfolioName}</td>}
      <td className={`${NUMERIC} text-muted`}>
        {formatShares(payment.shares)} × {display.money(payment.perShare)}
      </td>
      {editing ? (
        <td colSpan={2} className="px-2 py-1">
          <form onSubmit={submit} className="flex items-center justify-end gap-1">
            <label htmlFor={inputId} className="sr-only">
              Cash received for the {what}, in USD
            </label>
            <span className="text-xs text-muted">USD</span>
            <input
              id={inputId}
              type="number"
              inputMode="decimal"
              min={0}
              step="any"
              // biome-ignore lint/a11y/noAutofocus: the owner just asked to edit this amount
              autoFocus
              value={draft}
              placeholder={payment.cash.toFixed(2)}
              aria-invalid={problem !== null}
              title={problem ?? undefined}
              onChange={(event) => {
                setDraft(event.target.value);
                setProblem(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape") onEdit(false);
              }}
              className={`${FIELD} h-7 w-28 text-right tabular-nums aria-invalid:ring-fall`}
            />
            <Button size="sm" variant="primary" type="submit">
              Save
            </Button>
            {payment.overridden && (
              <IconButton
                label={`Use the worked-out amount for the ${what}`}
                onClick={() => onSave(null)}
              >
                <ArrowCounterClockwiseIcon aria-hidden size={14} />
              </IconButton>
            )}
            <IconButton label="Cancel" onClick={() => onEdit(false)}>
              <XIcon aria-hidden size={14} />
            </IconButton>
          </form>
          {problem && (
            <p role="alert" className="mt-1 text-right text-xs text-fall">
              {problem}
            </p>
          )}
        </td>
      ) : (
        <>
          <td className={`${NUMERIC} font-medium text-text`}>
            {display.money(payment.cash)}
            {payment.overridden && (
              <span
                className="ml-1.5 text-xs font-normal text-muted"
                title="The amount you entered"
              >
                edited
              </span>
            )}
          </td>
          <td className="px-2 py-1 text-right whitespace-nowrap">
            <IconButton
              label={`Edit the amount for the ${what}`}
              onClick={() => {
                setDraft(payment.overridden ? String(payment.cash) : "");
                setProblem(null);
                onEdit(true);
              }}
              className="opacity-60 group-hover:opacity-100 group-focus-within:opacity-100"
            >
              <PencilSimpleIcon aria-hidden size={14} />
            </IconButton>
          </td>
        </>
      )}
    </tr>
  );
}

function CalendarSection({
  positions,
  trades,
  dividends,
  withholding,
  display,
}: {
  positions: readonly ValuedPosition[];
  trades: readonly Trade[];
  dividends: Dividends | undefined;
  withholding: number;
  display: DisplayCurrency;
}) {
  const calendar = dividends
    ? dividendCalendar({
        positions,
        trades,
        dividends: dividends.bySymbol,
        today: dividends.today,
        months: CALENDAR_MONTHS,
        withholding,
      })
    : null;
  const total = calendar ? calendar.months.reduce((sum, month) => sum + month.cash, 0) : 0;
  const anyPayments = calendar?.months.some((month) => month.payments.length > 0) ?? false;
  const anyExpected =
    calendar?.months.some((month) => month.payments.some((payment) => payment.expected)) ?? false;

  return (
    <section aria-labelledby="calendar-heading" className="grid gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <h2 id="calendar-heading" className={`${HEADING} flex items-center gap-1.5`}>
          <CalendarDotsIcon aria-hidden size={16} className="text-accent" />
          Dividend calendar
        </h2>
        {calendar && anyPayments && (
          <span className="text-xs text-muted tabular-nums">
            Next {CALENDAR_MONTHS} months: {display.money(total)}
            {withholding > 0 ? ` after ${withholding}% withholding` : " before tax"}
          </span>
        )}
      </div>

      {!calendar && <p className="text-sm text-muted">Loading dividend schedules…</p>}
      {calendar && !anyPayments && (
        <p className="rounded-xl bg-subtle/60 p-4 text-sm text-muted">
          {calendar.unknown.length > 0
            ? `Dividend data for ${calendar.unknown.join(", ")} is unavailable right now. Reload the page to try again.`
            : `Nothing you hold now is expected to pay a dividend in the next ${CALENDAR_MONTHS} months.`}
        </p>
      )}

      {calendar && anyPayments && (
        <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {calendar.months.map((month) => (
            <li key={month.month} className="grid content-start gap-2 rounded-xl bg-subtle p-3">
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="text-sm font-medium text-text">
                  {MONTH_LABEL.format(Date.parse(`${month.month}-01T00:00:00Z`))}
                </h3>
                <span className="text-sm font-semibold text-text tabular-nums">
                  {month.payments.length > 0 ? display.money(month.cash) : "—"}
                </span>
              </div>
              {month.payments.length > 0 ? (
                <ul className="grid gap-1 text-xs tabular-nums">
                  {month.payments.map((payment) => (
                    <li
                      key={`${payment.symbol}:${payment.exDate}`}
                      className="flex items-baseline justify-between gap-2"
                    >
                      <span className="text-muted">
                        {formatDay(payment.payDate ?? payment.exDate, month.month)}{" "}
                        <span className="font-medium text-text">{payment.symbol}</span>
                        {payment.expected && <span className="ml-1">expected</span>}
                      </span>
                      <span className="text-text">{display.money(payment.cash)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-muted">Nothing due</p>
              )}
            </li>
          ))}
        </ol>
      )}

      {calendar && anyPayments && (
        <p className="text-xs text-muted">
          {calendar.unknown.length > 0 &&
            `Not included (dividend data unavailable): ${calendar.unknown.join(", ")}. `}
          {anyExpected && "“Expected” dates are estimated from each stock's usual schedule. "}
          Assumes you keep today's shares and each stock keeps its current dividend; a payout whose
          ex-dividend date has passed counts the shares you held before it.
        </p>
      )}
    </section>
  );
}
