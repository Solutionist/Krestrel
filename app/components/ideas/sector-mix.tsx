import { PlusIcon } from "@phosphor-icons/react";

import { type Focus, SECTOR_SHORT, type Sector } from "~/lib/ideas";

import { ToggleChip } from "../ui/button";
import { HEADING, LABEL } from "../ui/styles";

/**
 * One calm colour per sector, so the mix bar, its legend and the idea cards line up. Kept away
 * from pure green/red so they never read as rise/fall.
 */
export const SECTOR_COLORS: Record<Sector, string> = {
  "Information Technology": "bg-sky-500",
  "Communication Services": "bg-indigo-400",
  "Consumer Discretionary": "bg-fuchsia-400",
  "Consumer Staples": "bg-amber-400",
  "Health Care": "bg-teal-500",
  Financials: "bg-blue-700",
  Industrials: "bg-slate-400",
  Energy: "bg-orange-400",
  Utilities: "bg-cyan-300",
  "Real Estate": "bg-rose-300",
  Materials: "bg-yellow-700",
};

const percent = new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 0 });

/** The starting mix by sector, Claude's read of it, and the sectors worth adding. */
export function SectorMix({
  sectorWeights,
  summary,
  suggestedSectors,
  focus,
  onFocus,
}: {
  sectorWeights: readonly { sector: Sector; weight: number }[];
  summary: string;
  suggestedSectors: readonly Sector[];
  focus: Focus;
  onFocus: (focus: Focus) => void;
}) {
  const sorted = [...sectorWeights].sort((a, b) => b.weight - a.weight);
  return (
    <section aria-labelledby="ideas-mix" className="grid gap-3 rounded-xl bg-subtle/60 p-4">
      <h2 id="ideas-mix" className={HEADING}>
        Your mix
      </h2>
      {sorted.length > 0 ? (
        <>
          <div aria-hidden className="flex h-2.5 gap-0.5 overflow-hidden rounded-full bg-subtle">
            {sorted.map(({ sector, weight }) => (
              <span
                key={sector}
                title={`${sector} ${percent.format(weight)}`}
                className={`h-full first:rounded-l-full last:rounded-r-full ${SECTOR_COLORS[sector]}`}
                style={{ width: `${weight * 100}%` }}
              />
            ))}
          </div>
          <ul aria-label="Sector weights" className="flex flex-wrap gap-x-3 gap-y-1.5 text-xs">
            {sorted.map(({ sector, weight }) => (
              <li key={sector} title={sector} className="flex items-center gap-1.5 text-text">
                <span aria-hidden className={`size-2 rounded-full ${SECTOR_COLORS[sector]}`} />
                {SECTOR_SHORT[sector]}
                <span className="text-muted tabular-nums">{percent.format(weight)}</span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="text-xs text-muted">No holdings to chart yet.</p>
      )}
      {summary && <p className="text-pretty text-text">{summary}</p>}
      {suggestedSectors.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className={`${LABEL} mr-1`}>Worth adding</span>
          {suggestedSectors.map((sector) => {
            const active = sector === focus;
            return (
              <ToggleChip
                key={sector}
                pressed={active}
                title={`Show ideas in ${sector}`}
                onClick={() => onFocus(sector)}
              >
                <span aria-hidden className={`size-2 rounded-full ${SECTOR_COLORS[sector]}`} />
                {SECTOR_SHORT[sector]}
                {!active && <PlusIcon aria-hidden size={12} />}
              </ToggleChip>
            );
          })}
        </div>
      )}
    </section>
  );
}
