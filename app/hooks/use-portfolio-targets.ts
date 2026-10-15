import { useCallback, useEffect, useRef, useState } from "react";

import { PortfolioTargetsResponseSchema, type TargetWeight } from "~/lib/rebalance";

const ENDPOINT = "/api/portfolio-targets";

export interface PortfolioTargetsState {
  /** Saved targets (percent), largest first; undefined while loading or after a load error. */
  targets: readonly TargetWeight[] | undefined;
  loadError: string | null;
  save: (targets: readonly TargetWeight[]) => void;
  saving: boolean;
  saveError: string | null;
}

type Loaded = { portfolioId: string } & (
  | { targets: TargetWeight[]; error: null }
  | { targets: undefined; error: string }
);

/**
 * A portfolio's target allocation (ADR 0026): loaded from GET /api/portfolio-targets, saved
 * (replacing them all) with a plain POST, so the page's loader doesn't rerun. After a save, the
 * server's copy is shown; a newer save cancels an older one still in flight.
 */
export function usePortfolioTargets(portfolioId: string): PortfolioTargetsState {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const pending = useRef<AbortController | null>(null);

  useEffect(() => {
    const abort = new AbortController();
    fetch(`${ENDPOINT}?p=${encodeURIComponent(portfolioId)}`, { signal: abort.signal })
      .then((response) => response.json())
      .then((json: unknown) => {
        const parsed = PortfolioTargetsResponseSchema.safeParse(json);
        if (!parsed.success) throw new Error("Unexpected answer");
        setLoaded(
          parsed.data.ok
            ? { portfolioId, targets: parsed.data.targets, error: null }
            : { portfolioId, targets: undefined, error: parsed.data.error.message },
        );
      })
      .catch(() => {
        if (abort.signal.aborted) return;
        setLoaded({
          portfolioId,
          targets: undefined,
          error:
            "Couldn't load the targets from the Krestrel server. Reload the page to try again.",
        });
      });
    return () => abort.abort();
  }, [portfolioId]);

  useEffect(() => () => pending.current?.abort(), []);

  const save = useCallback(
    (targets: readonly TargetWeight[]) => {
      pending.current?.abort();
      const abort = new AbortController();
      pending.current = abort;
      setSaving(true);
      setSaveError(null);
      fetch(ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          portfolioId,
          targets: targets.map(({ symbol, weight }) => ({ symbol, weight })),
        }),
        signal: abort.signal,
      })
        .then((response) => response.json())
        .then((json: unknown) => {
          const parsed = PortfolioTargetsResponseSchema.safeParse(json);
          if (!parsed.success) throw new Error("Unexpected answer");
          if (abort.signal.aborted) return;
          if (parsed.data.ok) {
            setLoaded({
              portfolioId: parsed.data.portfolioId,
              targets: parsed.data.targets,
              error: null,
            });
          } else {
            setSaveError(parsed.data.error.message);
          }
        })
        .catch(() => {
          if (abort.signal.aborted) return;
          setSaveError("Couldn't save the targets to the Krestrel server. Try again.");
        })
        .finally(() => {
          if (pending.current === abort) {
            pending.current = null;
            setSaving(false);
          }
        });
    },
    [portfolioId],
  );

  const current = loaded?.portfolioId === portfolioId ? loaded : null;
  return {
    targets: current?.targets,
    loadError: current?.error ?? null,
    save,
    saving,
    saveError,
  };
}
