import { CaretRightIcon, DownloadSimpleIcon, ReceiptIcon } from "@phosphor-icons/react";
import { Fragment, useState } from "react";

import type { DisplayCurrency } from "~/hooks/use-currency";
import { useFxHistory } from "~/hooks/use-fx-history";
import { nyDay } from "~/lib/candles";
import { BASE_CURRENCY, formatMoney } from "~/lib/currency";
import type { ReceivedDividend } from "~/lib/dividends-received";
import { formatShares } from "~/lib/format";
import { FX_HISTORY_START } from "~/lib/fx-history";
import type { Trade } from "~/lib/portfolio";
import { type TaxSell, type TaxYear, taxReport, taxSellsCsv } from "~/lib/tax-report";

import { formatDay } from "../dividend-text";
import { Button } from "../ui/button";
import { HEADING, toneOf } from "../ui/styles";

const NUMBER = "py-1.5 text-right tabular-nums";
const HEAD = "py-1 font-normal";

/** Signed amount with ▲/▼ so the direction never relies on colour. */
function Gain({ amount, currency }: { amount: number; currency: string }) {
  const glyph = amount > 0.005 ? "▲ " : amount < -0.005 ? "▼ " : "";
  return (
    <span className={toneOf(amount)}>
      {glyph}
      {formatMoney(amount, currency, true)}
    </span>
  );
}

/**
 * Yearly realized P/L and dividends received for the owner's records (ADR 0027), in the display
 * currency with each sell and payout converted at its own date's ECB rate. Falls back to USD when
 * past rates can't be loaded. Each year expands to its sells; the sells download as CSV.
 * `receivedError` is why the received dividends couldn't be loaded (they then show the problem
 * instead of loading).
 */
export function TaxReportPanel({
  trades,
  received,
  receivedError,
  display,
}: {
  trades: readonly Trade[];
  received: ReceivedDividend[] | undefined;
  receivedError: string | null;
  display: DisplayCurrency;
}) {
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  let from: string | null = null;
  for (const day of [
    ...trades.map((trade) => trade.tradedOn),
    ...(received ?? []).map((payout) => payout.payDate ?? payout.exDate),
  ]) {
    if (from === null || day < from) from = day;
  }
  // Rates start in 1999; an earlier day uses the first rate.
  if (from !== null && from < FX_HISTORY_START) from = FX_HISTORY_START;
  const history = useFxHistory(display.currency, from);
  const dividendsFailed = received === undefined && receivedError !== null;

  if (history.status === "loading") {
    return <p className="text-sm text-muted">Loading past {display.currency} exchange rates…</p>;
  }
  const currency = history.status === "ready" ? history.quote : BASE_CURRENCY;
  const report = taxReport({
    trades,
    received,
    rateOn: history.status === "ready" ? history.rateOn : () => 1,
  });
  const converting = currency !== BASE_CURRENCY;
  const money = (amount: number) => formatMoney(amount, currency);

  function toggle(year: string) {
    setOpen((current) => {
      const next = new Set(current);
      if (!next.delete(year)) next.add(year);
      return next;
    });
  }

  function download() {
    const blob = new Blob([taxSellsCsv(report.sells, currency)], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `krestrel-realized-${currency}-${nyDay(Date.now())}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section aria-labelledby="tax-report-heading" className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
        <h2 id="tax-report-heading" className={`${HEADING} flex items-center gap-1.5`}>
          <ReceiptIcon aria-hidden size={16} className="text-accent" />
          Realized P/L and dividends by year
        </h2>
        <Button size="sm" onClick={download} disabled={report.sells.length === 0}>
          <DownloadSimpleIcon aria-hidden size={14} />
          Download sells (CSV)
        </Button>
      </div>

      {history.status === "error" && (
        <p role="status" className="text-xs text-muted">
          {history.message}
        </p>
      )}

      {receivedError !== null && (
        <p role="alert" className="text-xs text-muted">
          {dividendsFailed ? "Dividends left out: " : "Dividends may be incomplete: "}
          {receivedError}
        </p>
      )}

      {report.years.length === 0 ? (
        <p className="text-sm text-muted">
          {received === undefined && !dividendsFailed
            ? "Loading dividends…"
            : "No sells or dividends yet. Realized P/L shows here once you sell."}
        </p>
      ) : (
        <table className="w-full text-sm">
          <caption className="sr-only">Realized P/L and dividends by year, in {currency}</caption>
          <thead>
            <tr className="text-xs text-muted">
              <th scope="col" className={`${HEAD} text-left`}>
                Year
              </th>
              <th scope="col" className={`${HEAD} text-right`}>
                Proceeds
              </th>
              <th scope="col" className={`${HEAD} text-right`}>
                Cost
              </th>
              <th scope="col" className={`${HEAD} text-right`}>
                Realized P/L
              </th>
              <th scope="col" className={`${HEAD} text-right`}>
                Dividends
              </th>
              <th scope="col" className={`${HEAD} text-right`}>
                Total
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-rule/60">
            {report.years.map((year) => {
              const expanded = open.has(year.year);
              const sells = report.sells.filter((sell) => sell.tradedOn.startsWith(year.year));
              return (
                <Fragment key={year.year}>
                  <tr>
                    <th scope="row" className="py-1.5 text-left font-medium text-text">
                      <button
                        type="button"
                        aria-expanded={expanded}
                        aria-controls={`tax-year-${year.year}`}
                        disabled={sells.length === 0}
                        onClick={() => toggle(year.year)}
                        className="inline-flex items-center gap-1 rounded-md tabular-nums hover:text-accent disabled:pointer-events-none"
                      >
                        <CaretRightIcon
                          aria-hidden
                          size={12}
                          className={`transition-transform ${expanded ? "rotate-90" : ""} ${
                            sells.length === 0 ? "invisible" : ""
                          }`}
                        />
                        {year.year}
                        <span className="text-xs font-normal text-muted">
                          {year.sells} {year.sells === 1 ? "sell" : "sells"}
                        </span>
                      </button>
                    </th>
                    <td className={`${NUMBER} text-text`}>{money(year.proceeds)}</td>
                    <td className={`${NUMBER} text-text`}>{money(year.cost)}</td>
                    <td className={NUMBER}>
                      <Gain amount={year.realized} currency={currency} />
                    </td>
                    <td className={`${NUMBER} text-text`}>
                      {year.dividends !== null
                        ? money(year.dividends)
                        : dividendsFailed
                          ? "Unavailable"
                          : "…"}
                    </td>
                    <td className={`${NUMBER} font-medium`}>
                      {year.total !== null ? (
                        <Gain amount={year.total} currency={currency} />
                      ) : dividendsFailed ? (
                        "Unavailable"
                      ) : (
                        "…"
                      )}
                    </td>
                  </tr>
                  {expanded && (
                    <tr id={`tax-year-${year.year}`}>
                      <td colSpan={6} className="pb-3">
                        <YearSells
                          year={year}
                          sells={sells}
                          currency={currency}
                          converting={converting}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      )}

      {report.years.some((year) => year.unconverted > 0) && (
        <p role="status" className="text-xs text-muted">
          The European Central Bank published no {currency} rate around some dates, so these are
          left out of the {currency} amounts (USD amounts still count):{" "}
          {report.years
            .filter((year) => year.unconverted > 0)
            .map((year) => `${year.year} (${year.unconverted})`)
            .join(", ")}
          .
        </p>
      )}

      <p className="text-xs text-muted">
        For your records, not tax advice.
        {converting && " Rates: European Central Bank, each trade's own date."} Average-cost method,
        fees included; dividends are the cash received, on the pay date.
      </p>
    </section>
  );
}

/** One year's sells, and how much of the realized P/L came from the exchange rate. */
function YearSells({
  year,
  sells,
  currency,
  converting,
}: {
  year: TaxYear;
  sells: readonly TaxSell[];
  currency: string;
  converting: boolean;
}) {
  return (
    <div className="grid gap-2 rounded-xl bg-subtle p-3">
      <table className="w-full text-xs">
        <caption className="sr-only">Sells in {year.year}</caption>
        <thead>
          <tr className="text-muted">
            <th scope="col" className={`${HEAD} text-left`}>
              Date
            </th>
            <th scope="col" className={`${HEAD} text-left`}>
              Stock
            </th>
            <th scope="col" className={`${HEAD} text-right`}>
              Shares
            </th>
            <th scope="col" className={`${HEAD} text-right`}>
              Proceeds
            </th>
            <th scope="col" className={`${HEAD} text-right`}>
              Cost
            </th>
            <th scope="col" className={`${HEAD} text-right`}>
              Gain
            </th>
            {converting && (
              <th scope="col" className={`${HEAD} text-right`}>
                Rate used
              </th>
            )}
          </tr>
        </thead>
        <tbody className="divide-y divide-rule/60">
          {sells.map((sell) => (
            <tr key={sell.id}>
              {/* Every row is in the year shown, so the date never needs its year. */}
              <td className="py-1.5 text-text">{formatDay(sell.tradedOn, sell.tradedOn)}</td>
              <td className="py-1.5 font-medium text-text">{sell.symbol}</td>
              <td className={`${NUMBER} text-text`}>{formatShares(sell.shares)}</td>
              {sell.gain === null ? (
                <td colSpan={converting ? 4 : 3} className="py-1.5 text-right text-muted">
                  No {currency} rate for this date; USD gain{" "}
                  {formatMoney(sell.gainUsd, BASE_CURRENCY, true)}
                </td>
              ) : (
                <>
                  <td className={`${NUMBER} text-text`}>
                    {formatMoney(sell.proceeds ?? 0, currency)}
                  </td>
                  <td className={`${NUMBER} text-text`}>{formatMoney(sell.cost ?? 0, currency)}</td>
                  <td className={NUMBER}>
                    <Gain amount={sell.gain} currency={currency} />
                  </td>
                  {converting && (
                    <td className={`${NUMBER} text-muted`}>
                      {sell.rate?.toLocaleString("en-US", { maximumFractionDigits: 4 })} {currency}
                      /USD
                    </td>
                  )}
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {converting && (
        <p className="text-xs text-muted">
          In USD the realized P/L was {formatMoney(year.realizedUsd, BASE_CURRENCY, true)}.{" "}
          {formatMoney(year.currencyEffect, currency, true)} of the{" "}
          {formatMoney(year.realized, currency, true)} came from the exchange rate moving between
          buying and selling.
        </p>
      )}
    </div>
  );
}
