import { CheckIcon, MagnifyingGlassIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { useFetcher } from "react-router";
import * as z from "zod";

import { type Asset, AssetSchema } from "~/lib/market";

import { Button } from "../ui/button";
import { FIELD, POPOVER } from "../ui/styles";

/** Mirrors `WatchlistActionResult` from app/routes/api.watchlist.ts (client-safe copy of the shape). */
type ActionResult = { ok: true } | { ok: false; error: { code: string; message: string } };

const SearchResponseSchema = z.union([
  z.object({ results: z.array(AssetSchema) }),
  z.object({ error: z.object({ message: z.string() }) }),
]);

const DEBOUNCE_MS = 120;

type SearchState =
  | { kind: "idle" }
  | { kind: "loading"; results: Asset[] }
  | { kind: "done"; results: Asset[] }
  | { kind: "error"; message: string };

/**
 * Add-symbol input with a ticker/company dropdown (WAI-ARIA combobox). Typing "a" lists listings
 * whose ticker starts with A, then company names. Enter adds the highlighted listing, or the typed
 * ticker when nothing is highlighted, so search is a convenience, never a requirement.
 */
export function SymbolSearch({
  existing,
  maxSymbols,
}: {
  existing: readonly string[];
  maxSymbols: number;
}) {
  const add = useFetcher<ActionResult>();
  const id = useId();
  const listId = `${id}-listbox`;
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [search, setSearch] = useState<SearchState>({ kind: "idle" });

  const full = existing.length >= maxSymbols;
  const adding = add.state !== "idle";
  const addError = add.data && !add.data.ok ? add.data.error.message : null;
  const results = search.kind === "done" || search.kind === "loading" ? search.results : [];
  const expanded = open && query.trim() !== "" && search.kind !== "idle";

  // Debounced, cancellable search as the user types.
  useEffect(() => {
    const q = query.trim();
    if (q === "") {
      setSearch({ kind: "idle" });
      return;
    }
    const abort = new AbortController();
    setSearch((current) => ({
      kind: "loading",
      results: current.kind === "done" || current.kind === "loading" ? current.results : [],
    }));
    const timer = setTimeout(() => {
      fetch(`/api/assets?q=${encodeURIComponent(q)}`, { signal: abort.signal })
        .then((response) => response.json())
        .then((body: unknown) => {
          const parsed = SearchResponseSchema.safeParse(body);
          if (!parsed.success)
            setSearch({ kind: "error", message: "Search returned an unexpected response." });
          else if ("results" in parsed.data)
            setSearch({ kind: "done", results: parsed.data.results });
          else setSearch({ kind: "error", message: parsed.data.error.message });
          setActive(-1);
        })
        .catch(() => {
          if (!abort.signal.aborted) {
            setSearch({
              kind: "error",
              message: "Search failed. Type the full ticker and press Add.",
            });
          }
        });
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [query]);

  // Clear after a successful add.
  useEffect(() => {
    if (add.state === "idle" && add.data?.ok) {
      setQuery("");
      setOpen(false);
      setActive(-1);
    }
  }, [add.state, add.data]);

  function submit(symbol: string) {
    const ticker = symbol.trim();
    if (ticker === "" || full) return;
    add.submit(
      { intent: "add", symbol: ticker },
      { method: "post", action: "/api/watchlist", encType: "application/json" },
    );
    setOpen(false);
  }

  const isAdded = (asset: Asset) => existing.includes(asset.symbol);

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    switch (event.key) {
      case "ArrowDown":
      case "ArrowUp": {
        if (results.length === 0) return;
        event.preventDefault();
        setOpen(true);
        // -1 = no option highlighted (Enter then adds the typed ticker); wraps through it.
        setActive((current) =>
          event.key === "ArrowDown"
            ? current + 1 >= results.length
              ? -1
              : current + 1
            : current <= -1
              ? results.length - 1
              : current - 1,
        );
        return;
      }
      case "Enter": {
        event.preventDefault();
        const chosen = expanded ? results[active] : undefined;
        if (chosen && !isAdded(chosen)) submit(chosen.symbol);
        else if (!chosen) submit(query);
        return;
      }
      case "Escape":
        if (expanded) {
          event.preventDefault();
          setOpen(false);
          setActive(-1);
        } else {
          setQuery("");
        }
        return;
      case "Tab":
        setOpen(false);
        return;
    }
  }

  const activeAsset = expanded ? results[active] : undefined;

  return (
    <form
      className="px-3 pb-2"
      onSubmit={(event) => {
        event.preventDefault();
        submit(query);
      }}
    >
      <div className="relative">
        <div className="relative flex items-center">
          <label className="sr-only" htmlFor={`${id}-input`}>
            Add symbol
          </label>
          <MagnifyingGlassIcon
            aria-hidden
            size={15}
            className="pointer-events-none absolute left-2.5 text-muted"
          />
          <input
            ref={input}
            id={`${id}-input`}
            role="combobox"
            aria-expanded={expanded}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={activeAsset ? `${id}-option-${activeAsset.symbol}` : undefined}
            aria-describedby={`${id}-help`}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => setOpen(false)}
            onKeyDown={onKeyDown}
            autoComplete="off"
            spellCheck={false}
            maxLength={40}
            disabled={full}
            placeholder={full ? "Watchlist full" : "Search ticker or company"}
            className={`${FIELD} h-9 w-full min-w-0 pr-[4.75rem] pl-8 disabled:cursor-not-allowed disabled:opacity-60`}
          />
          <Button
            type="submit"
            variant="primary"
            size="sm"
            disabled={full || adding || query.trim() === ""}
            className="absolute right-1"
          >
            {adding ? "Adding…" : "Add"}
          </Button>
        </div>

        {expanded && (
          <div
            id={listId}
            role="listbox"
            aria-label="Matching listings"
            className={`${POPOVER} absolute inset-x-0 top-full z-20 mt-1.5 max-h-80 overflow-y-auto`}
          >
            {search.kind === "error" ? (
              <p className="flex items-center gap-1.5 px-2.5 py-2 text-xs text-fall">
                <WarningCircleIcon aria-hidden size={14} className="shrink-0" />
                {search.message}
              </p>
            ) : results.length === 0 ? (
              <p className="px-2.5 py-2 text-xs text-muted">
                {search.kind === "loading"
                  ? "Searching…"
                  : `No listings match “${query.trim()}”. Press Enter to try it as a ticker.`}
              </p>
            ) : (
              results.map((asset, index) => {
                const added = isAdded(asset);
                return (
                  // biome-ignore lint/a11y/useKeyWithClickEvents: combobox pattern; keys are handled on the input via aria-activedescendant, options never take focus.
                  <div
                    key={asset.symbol}
                    id={`${id}-option-${asset.symbol}`}
                    role="option"
                    aria-selected={index === active}
                    aria-disabled={added}
                    tabIndex={-1}
                    // Keep focus in the input so the combobox stays open while clicking.
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseEnter={() => setActive(index)}
                    onClick={() => !added && submit(asset.symbol)}
                    className={`grid grid-cols-[4rem_minmax(0,1fr)_auto] items-baseline gap-2 rounded-lg px-2.5 py-2 text-sm ${
                      index === active ? "bg-subtle" : ""
                    } ${added ? "cursor-default opacity-60" : "cursor-pointer"}`}
                  >
                    <span className="truncate font-semibold tracking-tight text-text">
                      {asset.symbol}
                    </span>
                    <span className="truncate text-muted">{asset.name}</span>
                    {added ? (
                      <span className="inline-flex items-center gap-1 self-center text-[11px] font-medium text-accent">
                        <CheckIcon aria-hidden size={12} />
                        Added
                      </span>
                    ) : (
                      <span className="text-[11px] text-muted">{asset.exchange}</span>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>

      <p id={`${id}-help`} className="mt-1.5 text-xs empty:mt-0" aria-live="polite">
        {full ? (
          <span className="text-accent">
            Watchlist full ({maxSymbols} symbols, the data plan's live limit). Remove one to add
            another.
          </span>
        ) : addError ? (
          <span className="inline-flex items-center gap-1.5 text-fall">
            <WarningCircleIcon aria-hidden size={14} className="shrink-0" />
            {addError}
          </span>
        ) : null}
      </p>
    </form>
  );
}
