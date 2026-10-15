import { WarningCircleIcon } from "@phosphor-icons/react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";

import { Button } from "~/components/ui/button";
import { CARD, FIELD, HEADING, LABEL, toneOf } from "~/components/ui/styles";
import type { DisplayCurrency } from "~/hooks/use-currency";
import { formatPercentChange } from "~/lib/format";
import type { PortfolioActionResult, PortfolioTotals } from "~/lib/portfolio";

export interface PortfolioEntry {
  /** null = all portfolios combined. */
  id: string | null;
  name: string;
  totals: PortfolioTotals;
}

/** Sidebar: "All" plus each portfolio with its value and unrealized P/L; creates new ones. */
export function PortfolioList({
  entries,
  selected,
  display,
  onSelect,
}: {
  entries: readonly PortfolioEntry[];
  selected: string | null;
  display: DisplayCurrency;
  onSelect: (id: string | null) => void;
}) {
  const create = useFetcher<PortfolioActionResult>();
  const [name, setName] = useState("");
  const result = create.data;
  const error = result && !result.ok ? result.error.message : null;

  // Open the portfolio just created, once: `onSelect` changes with every URL change, and running
  // this again would navigate to the current URL (reloading the page data) and drop a trade edit.
  const opened = useRef<PortfolioActionResult | undefined>(undefined);
  useEffect(() => {
    if (create.state !== "idle" || !result?.ok || !result.portfolioId) return;
    if (opened.current === result) return;
    opened.current = result;
    setName("");
    onSelect(result.portfolioId);
  }, [create.state, result, onSelect]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    create.submit(
      { intent: "create", name },
      { method: "post", action: "/api/portfolios", encType: "application/json" },
    );
  }

  return (
    <aside className={`${CARD} flex min-h-0 flex-col`} aria-label="Portfolios">
      <h2 className={`px-4 pt-4 pb-3 ${HEADING}`}>Portfolios</h2>
      <nav
        aria-label="Portfolio"
        className="grid min-h-0 flex-1 content-start gap-0.5 overflow-y-auto px-2 pb-2"
      >
        {entries.map((entry) => {
          const active = entry.id === selected;
          return (
            <button
              key={entry.id ?? "all"}
              type="button"
              aria-current={active ? "page" : undefined}
              onClick={() => onSelect(entry.id)}
              className={`grid w-full grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 gap-y-0.5 rounded-lg px-3 py-2.5 text-left text-sm transition-colors duration-150 ${
                active ? "bg-accent/10" : "hover:bg-subtle"
              }`}
            >
              <span className={`truncate ${entry.id ? "font-medium text-text" : "text-muted"}`}>
                {entry.name}
              </span>
              <span className="text-right font-medium text-text tabular-nums">
                {display.money(entry.totals.marketValue)}
              </span>
              <span
                className={`col-start-2 text-right text-xs tabular-nums ${toneOf(entry.totals.unrealized)}`}
              >
                {entry.totals.unrealizedFraction === null
                  ? "—"
                  : formatPercentChange(entry.totals.unrealizedFraction)}
              </span>
            </button>
          );
        })}
      </nav>
      <form onSubmit={submit} className="grid gap-1.5 border-t border-rule/60 p-3">
        <label className={LABEL} htmlFor="new-portfolio">
          New portfolio
        </label>
        <div className="flex min-w-0 gap-2">
          <input
            id="new-portfolio"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. Long term"
            maxLength={40}
            required
            className={`${FIELD} h-9 min-w-0 flex-1`}
          />
          <Button type="submit" variant="secondary" size="md" disabled={create.state !== "idle"}>
            Create
          </Button>
        </div>
        {error && (
          <p role="alert" className="flex items-center gap-1.5 text-xs text-fall">
            <WarningCircleIcon aria-hidden size={14} className="shrink-0" />
            {error}
          </p>
        )}
      </form>
    </aside>
  );
}
