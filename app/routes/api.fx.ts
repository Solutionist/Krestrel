import { fxRates } from "~/.server/fx/instance";
import type { FxResponse } from "~/lib/currency";

/** GET /api/fx → latest USD reference rates for display conversion (ADR 0013). */
export async function loader() {
  const result = await fxRates.get();
  return result.ok
    ? Response.json({ ok: true, fx: result.fx } satisfies FxResponse)
    : Response.json({ ok: false, error: { message: result.message } } satisfies FxResponse, {
        status: 502,
      });
}
