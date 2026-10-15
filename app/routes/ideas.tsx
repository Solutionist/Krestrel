import { LightbulbIcon, WarningCircleIcon, WarningIcon } from "@phosphor-icons/react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import * as z from "zod";

import { getMarketHub } from "~/.server/market/instance";
import { AppShell } from "~/components/app-shell";
import { claudeModel } from "~/components/chart/outlook-panel";
import { IdeaCard, IdeaCardSkeleton } from "~/components/ideas/idea-card";
import { IdeasSidebar } from "~/components/ideas/ideas-sidebar";
import { SectorMix } from "~/components/ideas/sector-mix";
import { TopBar } from "~/components/top-bar";
import { Button } from "~/components/ui/button";
import { CARD, HEADING } from "~/components/ui/styles";
import { type MarketState, useMarketStream } from "~/hooks/use-market-stream";
import { useNow } from "~/hooks/use-now";
import {
  FOCUSES,
  type Focus,
  IDEA_CATEGORIES,
  IDEA_CATEGORY_LABELS,
  type IdeaCategory,
  type IdeasResponse,
  IdeasResponseSchema,
  SECTOR_SHORT,
} from "~/lib/ideas";
import { describeConnection, describeMarket } from "~/lib/status-text";

import type { Route } from "./+types/ideas";

type IdeasResult = Extract<IdeasResponse, { ok: true }>;
type Results = Partial<Record<Focus, IdeasResult>>;
type Request =
  | { kind: "idle" }
  | { kind: "loading"; focus: Focus }
  | { kind: "error"; focus: Focus; message: string };

const CONSENT_KEY = "krestrel.ideasConsent";
/** Last successful result per focus, so coming back shows it (JSON `{ [focus]: IdeasResponse }`). */
const RESULTS_KEY = "krestrel.ideas";

const BASIS_TEXT: Record<IdeasResult["basis"], string> = {
  portfolio: "Based on your portfolio",
  watchlist: "Based on your watchlist",
  none: "No holdings yet: general ideas",
};

const generatedTime = new Intl.DateTimeFormat([], {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export function meta(_: Route.MetaArgs) {
  return [{ title: "Ideas · Krestrel" }];
}

export function loader() {
  return { snapshot: getMarketHub().snapshot() };
}

/** Saved results, each validated on its own so one stale entry doesn't drop the rest. */
function loadResults(): Results {
  let stored: unknown = null;
  try {
    stored = JSON.parse(localStorage.getItem(RESULTS_KEY) ?? "null");
  } catch {
    return {};
  }
  const record = z.record(z.string(), z.unknown()).safeParse(stored);
  if (!record.success) return {};
  const results: Results = {};
  for (const focus of FOCUSES) {
    const parsed = IdeasResponseSchema.safeParse(record.data[focus]);
    if (parsed.success && parsed.data.ok && parsed.data.focus === focus) {
      results[focus] = parsed.data;
    }
  }
  return results;
}

function saveResults(results: Results) {
  try {
    localStorage.setItem(RESULTS_KEY, JSON.stringify(results));
  } catch {
    // Storage full or disabled: the result lasts until reload.
  }
}

export default function IdeasPage({ loaderData }: Route.ComponentProps) {
  const { state } = useMarketStream(loaderData.snapshot);
  const now = useNow();
  const [model] = claudeModel.use();
  const [focus, setFocus] = useState<Focus>("diversify");
  const [results, setResults] = useState<Results>({});
  const [request, setRequest] = useState<Request>({ kind: "idle" });
  const requestId = useRef(0);

  // SSR renders idle; saved results only exist in the browser.
  useEffect(() => setResults(loadResults()), []);

  const result = results[focus] ?? null;
  const loading = request.kind === "loading";
  const error = request.kind === "error" && request.focus === focus ? request.message : null;

  async function findIdeas() {
    if (localStorage.getItem(CONSENT_KEY) !== "yes") {
      const ok = window.confirm(
        "Find ideas sends the tickers you hold and their share of your portfolio (no amounts or share counts) to Anthropic via your Claude Code CLI; Claude also searches the web. Continue?",
      );
      if (!ok) return;
      localStorage.setItem(CONSENT_KEY, "yes");
    }
    const asked = focus;
    const id = ++requestId.current;
    setRequest({ kind: "loading", focus: asked });
    let next: Request = { kind: "idle" };
    try {
      const response = await fetch("/api/ideas", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ focus: asked, model }),
      });
      const parsed = IdeasResponseSchema.safeParse(await response.json());
      if (!parsed.success) {
        next = {
          kind: "error",
          focus: asked,
          message: "The ideas came back in an unexpected format.",
        };
      } else if (!parsed.data.ok) {
        next = { kind: "error", focus: asked, message: parsed.data.error.message };
      } else {
        const fresh = parsed.data;
        setResults((current) => {
          const updated = { ...current, [asked]: fresh };
          saveResults(updated);
          return updated;
        });
      }
    } catch {
      next = { kind: "error", focus: asked, message: "Couldn't reach the Krestrel server." };
    }
    if (id === requestId.current) setRequest(next);
  }

  const market = describeMarket(state.clock);
  const connection = describeConnection(state.link, state.status, now);

  return (
    <AppShell
      header={
        <TopBar market={market} connection={connection} dataLabel={state.provider.liveDataLabel} />
      }
      sidebar={
        <IdeasSidebar
          focus={focus}
          onFocus={setFocus}
          loading={loading}
          hasResult={result !== null}
          onFind={findIdeas}
        />
      }
    >
      <main id="main" className={`${CARD} min-h-0 overflow-y-auto`}>
        <div aria-live="polite" className="mx-auto grid max-w-[1180px] gap-6 px-6 py-6 text-sm">
          <header className="grid gap-1">
            <h1 className="text-lg font-semibold tracking-tight text-text">Stock ideas</h1>
            <p className="text-sm text-muted tabular-nums">
              {[
                result ? BASIS_TEXT[result.basis] : "Pick a focus, then find ideas",
                focus === "diversify" ? null : `Focus: ${SECTOR_SHORT[focus]}`,
                result && !loading
                  ? `${generatedTime.format(new Date(result.generatedAt))} · ${[result.provider, result.model].filter(Boolean).join(" ")}`
                  : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </header>

          {error && (
            <p className="flex items-start gap-1.5 text-fall">
              <WarningCircleIcon aria-hidden size={16} className="mt-px shrink-0" />
              {error}
            </p>
          )}

          {loading ? (
            <Loading />
          ) : result ? (
            <Result result={result} focus={focus} onFocus={setFocus} state={state} />
          ) : (
            !error && <Idle onFind={findIdeas} />
          )}
        </div>
      </main>
    </AppShell>
  );
}

function Result({
  result,
  focus,
  onFocus,
  state,
}: {
  result: IdeasResult;
  focus: Focus;
  onFocus: (focus: Focus) => void;
  state: MarketState;
}) {
  return (
    <>
      <SectorMix
        sectorWeights={result.sectorWeights}
        summary={result.summary}
        suggestedSectors={result.suggestedSectors}
        focus={focus}
        onFocus={onFocus}
      />
      {IDEA_CATEGORIES.map((category) => {
        const ideas = result.ideas.filter((idea) => idea.category === category);
        return (
          <CategorySection key={category} category={category}>
            {ideas.length === 0 ? (
              <p className="text-muted">No {category} ideas this time.</p>
            ) : (
              <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
                {ideas.map((idea) => (
                  <IdeaCard
                    key={idea.symbol}
                    idea={idea}
                    quote={state.quotes[idea.symbol] ?? null}
                    // The live watchlist, not the flag saved with the idea, which may be stale.
                    watched={state.watchlist.includes(idea.symbol)}
                  />
                ))}
              </div>
            )}
          </CategorySection>
        );
      })}
    </>
  );
}

function CategorySection({ category, children }: { category: IdeaCategory; children: ReactNode }) {
  const label = IDEA_CATEGORY_LABELS[category];
  return (
    <section aria-labelledby={`ideas-${category}`} className="grid gap-3">
      <div className="grid gap-0.5">
        <h2 id={`ideas-${category}`} className={`${HEADING} flex items-center gap-1.5`}>
          {category === "risky" && <WarningIcon aria-hidden size={15} className="text-fall/70" />}
          {label.name}
        </h2>
        <p className="text-xs text-muted">{label.hint}</p>
      </div>
      {children}
    </section>
  );
}

function Loading() {
  return (
    <>
      <p className="flex items-center gap-1.5 text-xs text-muted">
        <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-accent" />
        Reading your mix and searching the market…
      </p>
      <span aria-hidden className="block h-24 animate-pulse rounded-xl bg-subtle/60" />
      {IDEA_CATEGORIES.map((category) => (
        <CategorySection key={category} category={category}>
          <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
            <IdeaCardSkeleton />
            <IdeaCardSkeleton />
          </div>
        </CategorySection>
      ))}
    </>
  );
}

function Idle({ onFind }: { onFind: () => void }) {
  return (
    <div className="grid justify-items-center gap-5 py-10 text-center">
      <span className="grid size-10 place-items-center rounded-xl bg-subtle text-accent ring-1 ring-inset ring-rule/60">
        <LightbulbIcon aria-hidden size={20} />
      </span>
      <div className="grid max-w-md gap-1">
        <h2 className="text-lg font-semibold tracking-tight text-text">Find stocks worth a look</h2>
        <p className="text-pretty text-muted">
          Claude reads which sectors your portfolio leans on, searches the market, and suggests 5 to
          10 stocks that fill the gaps, or that fit the sector you pick.
        </p>
      </div>
      <ul className="grid w-full max-w-2xl gap-3 text-left sm:grid-cols-3">
        {IDEA_CATEGORIES.map((category) => (
          <li key={category} className="grid content-start gap-1 rounded-xl bg-subtle/60 p-4">
            <span className="flex items-center gap-1.5 font-medium text-text">
              {category === "risky" && (
                <WarningIcon aria-hidden size={14} className="text-fall/70" />
              )}
              {IDEA_CATEGORY_LABELS[category].name}
            </span>
            <span className="text-xs text-pretty text-muted">
              {IDEA_CATEGORY_LABELS[category].hint}
            </span>
          </li>
        ))}
      </ul>
      <Button variant="primary" onClick={onFind}>
        <LightbulbIcon aria-hidden size={16} />
        Find ideas
      </Button>
    </div>
  );
}
