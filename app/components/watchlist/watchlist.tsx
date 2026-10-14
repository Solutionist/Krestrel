import {
  CaretDownIcon,
  ListPlusIcon,
  SortAscendingIcon,
  SortDescendingIcon,
  WarningCircleIcon,
  XIcon,
} from "@phosphor-icons/react";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";

import type { QuoteSnapshot } from "~/lib/market";
import type { RsiLevels, RsiSignal } from "~/lib/rsi-signal";
import {
  DEFAULT_SORT_DIRECTION,
  sortSymbols,
  WATCHLIST_SORT_KEYS,
  WATCHLIST_SORT_LABELS,
  type WatchlistSort,
} from "~/lib/watchlist-sort";

import { IconButton } from "../ui/button";
import { CARD, FIELD, HEADING } from "../ui/styles";
import { SymbolSearch } from "./symbol-search";
import { WatchlistRow } from "./watchlist-row";

/** Mirrors `WatchlistActionResult` from app/routes/api.watchlist.ts (client-safe copy of the shape). */
type ActionResult = { ok: true } | { ok: false; error: { code: string; message: string } };

const ACTION = "/api/watchlist";
const SORT_STORAGE_KEY = "krestrel.watchlistSort";
const DEFAULT_SORT: WatchlistSort = { key: "manual", direction: "desc" };

function isWatchlistSort(value: unknown): value is WatchlistSort {
  if (typeof value !== "object" || value === null) return false;
  const key: unknown = Reflect.get(value, "key");
  const direction: unknown = Reflect.get(value, "direction");
  return (
    WATCHLIST_SORT_KEYS.some((known) => known === key) &&
    (direction === "asc" || direction === "desc")
  );
}

/** Sort choice remembered in localStorage; the default on the server and first render (no hydration mismatch). */
function usePersistedSort(): [WatchlistSort, (next: WatchlistSort) => void] {
  const [sort, setSort] = useState<WatchlistSort>(DEFAULT_SORT);

  useEffect(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(SORT_STORAGE_KEY) ?? "null");
      if (isWatchlistSort(saved)) setSort({ key: saved.key, direction: saved.direction });
    } catch {
      // Corrupt or unavailable storage: keep the default.
    }
  }, []);

  function save(next: WatchlistSort) {
    setSort(next);
    try {
      localStorage.setItem(SORT_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Storage full or disabled: keep the in-memory choice.
    }
  }

  return [sort, save];
}

export function Watchlist({
  symbols,
  quotes,
  selected,
  maxSymbols,
  onSelect,
  signals,
  levels,
}: {
  symbols: string[];
  quotes: Record<string, QuoteSnapshot>;
  selected: string | null;
  maxSymbols: number;
  onSelect: (symbol: string) => void;
  /** Daily RSI signal per symbol (ADR 0014). */
  signals: Record<string, RsiSignal | null>;
  levels: RsiLevels;
}) {
  const mutate = useFetcher<ActionResult>();
  const [sort, setSort] = usePersistedSort();
  const manual = sort.key === "manual";
  const ordered = sortSymbols(symbols, quotes, sort, signals);
  const rows = useRef(new Map<string, HTMLDivElement>());
  const mutateError = mutate.data && !mutate.data.ok ? mutate.data.error.message : null;

  const focusRow = (symbol: string | undefined) => {
    if (symbol) rows.current.get(symbol)?.focus();
  };

  function remove(symbol: string) {
    if (!window.confirm(`Remove ${symbol} from your watchlist? Its alerts are removed too.`))
      return;
    const index = ordered.indexOf(symbol);
    mutate.submit(
      { intent: "remove", symbol },
      { method: "post", action: ACTION, encType: "application/json" },
    );
    focusRow(ordered[index + 1] ?? ordered[index - 1]);
  }

  function move(symbol: string, delta: -1 | 1) {
    if (!manual) return;
    const from = symbols.indexOf(symbol);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= symbols.length) return;
    const next = [...symbols];
    next.splice(from, 1);
    next.splice(to, 0, symbol);
    mutate.submit(
      { intent: "reorder", symbols: next },
      { method: "post", action: ACTION, encType: "application/json" },
    );
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>, symbol: string) {
    const index = ordered.indexOf(symbol);
    switch (event.key) {
      case "ArrowDown":
      case "ArrowUp": {
        event.preventDefault();
        const delta = event.key === "ArrowDown" ? 1 : -1;
        if (event.altKey) move(symbol, delta);
        else focusRow(ordered[index + delta]);
        return;
      }
      case "Home":
        event.preventDefault();
        focusRow(ordered[0]);
        return;
      case "End":
        event.preventDefault();
        focusRow(ordered.at(-1));
        return;
      case "Enter":
      case " ":
        event.preventDefault();
        onSelect(symbol);
        return;
      case "Delete":
      case "Backspace":
        event.preventDefault();
        remove(symbol);
        return;
    }
  }

  // Roving tabindex: one tab stop for the whole list (the selected row, else the first).
  const tabStop = selected && symbols.includes(selected) ? selected : ordered[0];

  return (
    <aside className={`${CARD} flex min-h-0 flex-col`} aria-label="Watchlist">
      <div className="flex items-center justify-between gap-2 px-4 pt-4 pb-3">
        <div className="flex shrink-0 items-baseline gap-2">
          <h2 className={HEADING}>Watchlist</h2>
          <span className="text-xs tabular-nums text-muted">
            {symbols.length}/{maxSymbols}
          </span>
        </div>
        {symbols.length > 1 && (
          <div className="flex min-w-0 items-center gap-1">
            <span className="relative min-w-0">
              <select
                aria-label="Sort by"
                value={sort.key}
                onChange={(event) => {
                  const key = WATCHLIST_SORT_KEYS.find((known) => known === event.target.value);
                  if (key) setSort({ key, direction: DEFAULT_SORT_DIRECTION[key] });
                }}
                className={`${FIELD} h-8 w-full min-w-0 max-w-[7.5rem] cursor-pointer appearance-none pr-7`}
              >
                {WATCHLIST_SORT_KEYS.map((key) => (
                  <option key={key} value={key}>
                    {WATCHLIST_SORT_LABELS[key]}
                  </option>
                ))}
              </select>
              <CaretDownIcon
                aria-hidden
                size={12}
                weight="bold"
                className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-muted"
              />
            </span>
            {!manual && (
              <IconButton
                label={sort.direction === "asc" ? "Ascending" : "Descending"}
                onClick={() =>
                  setSort({ key: sort.key, direction: sort.direction === "asc" ? "desc" : "asc" })
                }
              >
                {sort.direction === "asc" ? (
                  <SortAscendingIcon aria-hidden size={16} />
                ) : (
                  <SortDescendingIcon aria-hidden size={16} />
                )}
              </IconButton>
            )}
          </div>
        )}
      </div>

      <SymbolSearch existing={symbols} maxSymbols={maxSymbols} />

      {symbols.length === 0 ? (
        <div className="flex flex-col items-center px-6 py-10 text-center">
          <span className="grid size-10 place-items-center rounded-xl bg-subtle text-muted">
            <ListPlusIcon aria-hidden size={20} />
          </span>
          <p className="mt-3 text-sm font-medium text-text">No symbols yet</p>
          <p className="mt-1 text-xs text-muted">
            Search above to add up to {maxSymbols} live symbols.
          </p>
        </div>
      ) : (
        <div
          role="listbox"
          aria-label={
            manual
              ? "Symbols. Arrow keys move, Enter opens the chart, Alt+Arrow reorders, Delete removes."
              : `Symbols sorted by ${WATCHLIST_SORT_LABELS[sort.key]}. Arrow keys move, Enter opens the chart, Delete removes. Reordering needs My order.`
          }
          className="flex min-h-0 flex-1 flex-col gap-px overflow-y-auto px-2 pb-2"
        >
          {ordered.map((symbol) => {
            const isSelected = symbol === selected;
            return (
              <div
                key={symbol}
                ref={(node) => {
                  if (node) rows.current.set(symbol, node);
                  else rows.current.delete(symbol);
                }}
                role="option"
                aria-selected={isSelected}
                tabIndex={symbol === tabStop ? 0 : -1}
                onClick={() => onSelect(symbol)}
                onKeyDown={(event) => onKeyDown(event, symbol)}
                className={`group relative shrink-0 cursor-pointer rounded-lg outline-offset-[-2px] transition-colors duration-150 ${
                  isSelected ? "bg-accent/10" : "hover:bg-subtle"
                }`}
              >
                <WatchlistRow
                  quote={
                    quotes[symbol] ?? { symbol, lastPrice: null, lastTs: null, previousClose: null }
                  }
                  signal={signals[symbol] ?? null}
                  levels={levels}
                />
                {/* Pointer shortcut only; keyboard users press Delete on the row. Hidden until hover so it never covers the price at rest. */}
                <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center opacity-0 transition-opacity duration-150 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-visible:opacity-100">
                  <IconButton
                    label={`Remove ${symbol}`}
                    variant="danger"
                    tabIndex={-1}
                    onClick={(event) => {
                      event.stopPropagation();
                      remove(symbol);
                    }}
                    className="bg-panel shadow-card ring-1 ring-rule/70"
                  >
                    <XIcon aria-hidden size={14} />
                  </IconButton>
                </span>
              </div>
            );
          })}
        </div>
      )}
      {mutateError && (
        <p className="flex items-center gap-1.5 px-4 py-2 text-xs text-fall">
          <WarningCircleIcon aria-hidden size={14} className="shrink-0" />
          {mutateError}
        </p>
      )}
    </aside>
  );
}
