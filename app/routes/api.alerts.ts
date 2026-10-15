import { getMarketHub } from "~/.server/market/instance";
import { crossSiteRejection } from "~/.server/same-origin";
import { AlertActionSchema, type AlertsResponse } from "~/lib/alerts";

import type { Route } from "./+types/api.alerts";

/** GET /api/alerts → active alerts plus those fired in the last week (ADR 0023). */
export async function loader() {
  return listResponse();
}

/**
 * POST /api/alerts (JSON):
 *   { intent: "create", symbol, direction: "above" | "below", price } | { intent: "delete", id }
 * Answers with the updated list. Errors: `invalid` 400, `not_watched` 400, `not_found` 404.
 */
export async function action({ request }: Route.ActionArgs) {
  const rejected = crossSiteRejection(request);
  if (rejected) return rejected;

  const parsed = AlertActionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return fail(400, "invalid", parsed.error.issues[0]?.message ?? "Invalid request");
  }

  const alerts = getMarketHub().alerts;
  const input = parsed.data;
  switch (input.intent) {
    case "create": {
      const { symbol, direction, price } = input;
      const result = await alerts.create({ symbol, direction, price });
      return result.ok ? listResponse() : fail(400, result.code, result.message);
    }
    case "delete":
      return (await alerts.delete(input.id))
        ? listResponse()
        : fail(404, "not_found", "That alert no longer exists. Reload to see your alerts.");
  }
}

async function listResponse(): Promise<Response> {
  const alerts = await getMarketHub().alerts.list();
  return Response.json({ ok: true, alerts } satisfies AlertsResponse);
}

function fail(status: number, code: string, message: string): Response {
  return Response.json({ ok: false, error: { code, message } } satisfies AlertsResponse, {
    status,
  });
}
