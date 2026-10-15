import * as z from "zod";

import { db } from "~/.server/market/db/instance";
import { listTargets, replaceTargets } from "~/.server/market/db/queries/portfolio-targets";
import { crossSiteRejection } from "~/.server/same-origin";
import { type PortfolioTargetsResponse, SaveTargetsSchema } from "~/lib/rebalance";

import type { Route } from "./+types/api.portfolio-targets";

const QuerySchema = z.object({ p: z.uuid() });

function fail(status: number, code: string, message: string): Response {
  return Response.json({ ok: false, error: { code, message } } satisfies PortfolioTargetsResponse, {
    status,
  });
}

/**
 * GET /api/portfolio-targets?p=<portfolio id> → `{ ok, portfolioId, targets: [{symbol, weight}] }`,
 * weights in percent, largest first (ADR 0026). An unknown portfolio has no targets.
 */
export async function loader({ request }: Route.LoaderArgs) {
  const query = QuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!query.success) return fail(400, "invalid", "Pick a portfolio.");
  const portfolioId = query.data.p;
  return Response.json({
    ok: true,
    portfolioId,
    targets: await listTargets(db, portfolioId),
  } satisfies PortfolioTargetsResponse);
}

/**
 * POST /api/portfolio-targets (JSON) `{ portfolioId, targets: [{symbol, weight}] }` replaces all
 * of the portfolio's targets (an empty list clears them). Weights 0.01–100, one per symbol,
 * adding up to 100% or less (the rest is cash). Returns the saved targets like GET. Errors:
 * `invalid` 400, `not_found` 404; requests from other websites are refused (403).
 */
export async function action({ request }: Route.ActionArgs) {
  const refused = crossSiteRejection(request);
  if (refused) return refused;
  const parsed = SaveTargetsSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return fail(400, "invalid", parsed.error.issues[0]?.message ?? "Invalid request");
  }
  const { portfolioId, targets } = parsed.data;
  if (!(await replaceTargets(db, portfolioId, targets))) {
    return fail(404, "not_found", "That portfolio no longer exists.");
  }
  return Response.json({
    ok: true,
    portfolioId,
    targets: await listTargets(db, portfolioId),
  } satisfies PortfolioTargetsResponse);
}
