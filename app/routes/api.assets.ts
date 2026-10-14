import * as z from "zod";

import { getMarketHub } from "~/.server/market/instance";

import type { Route } from "./+types/api.assets";

const QuerySchema = z.object({
  q: z.string().trim().max(40).default(""),
  limit: z.coerce.number().int().min(1).max(20).default(8),
});

/** GET /api/assets?q=a → `{ results: Asset[] }` ranked by ticker, then company name. */
export async function loader({ request }: Route.LoaderArgs) {
  const query = QuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!query.success) {
    return Response.json(
      { error: { code: "invalid", message: "Invalid search" } },
      { status: 400 },
    );
  }
  try {
    const results = await getMarketHub().searchAssets(query.data.q, query.data.limit);
    return Response.json({ results });
  } catch {
    return Response.json(
      {
        error: {
          code: "upstream",
          message: "Symbol search is unavailable right now. Type the full ticker and press Add.",
        },
      },
      { status: 502 },
    );
  }
}
