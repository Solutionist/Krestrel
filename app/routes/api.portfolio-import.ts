import { aiFailureResponse, getAi } from "~/.server/llm/instance";
import { getMarketHub } from "~/.server/market/instance";
import { readHoldingsFromImage, type ScreenshotReading } from "~/.server/portfolio-import/vision";
import { crossSiteRejection } from "~/.server/same-origin";
import { type AiChoice, AiChoiceSchema, DEFAULT_AI_OVERRIDES } from "~/lib/ai";
import {
  type HoldingsReadResult,
  IMPORT_IMAGE_TYPES,
  MAX_IMPORT_IMAGE_BYTES,
} from "~/lib/holdings-import";

import type { Route } from "./+types/api.portfolio-import";

function fail(status: number, code: string, message: string): Response {
  return Response.json({ ok: false, error: { code, message } } satisfies HoldingsReadResult, {
    status,
  });
}

const TOO_LARGE = "That image is too large. Crop it to your holdings and try again.";

/** The `ai` form field (JSON); without one the screenshot stays on this computer. */
function aiChoice(raw: FormDataEntryValue | null | undefined): AiChoice | null {
  const fallback = DEFAULT_AI_OVERRIDES.import ?? { provider: "local", model: null };
  if (typeof raw !== "string") return fallback;
  try {
    const parsed = AiChoiceSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * POST /api/portfolio-import (multipart: `image`, `ai` = JSON AI choice, `masked`) → holdings read
 * from a broker screenshot by the chosen AI, for review; nothing is saved here (ADR 0018, 0020). A
 * local model keeps the image on this machine. Claude only gets a copy the page masked on this
 * computer and the owner approved (`masked=1`, ADR 0021); anything else is refused. Only the
 * tickers read go to the market data provider's listing check. Requests from other websites are
 * refused, and oversized uploads are refused before they are read.
 */
export async function action({ request }: Route.ActionArgs) {
  const refused = crossSiteRejection(request);
  if (refused) return refused;
  // Checked before parsing: formData() buffers the whole body in memory. The slack covers the
  // multipart envelope around the image.
  if (Number(request.headers.get("content-length")) > MAX_IMPORT_IMAGE_BYTES + 64 * 1024) {
    return fail(413, "too_large", TOO_LARGE);
  }
  const form = await request.formData().catch(() => null);
  const image = form?.get("image");
  if (!(image instanceof File) || image.size === 0) {
    return fail(400, "invalid", "Choose a screenshot of your holdings to read.");
  }
  if (image.size > MAX_IMPORT_IMAGE_BYTES) return fail(413, "too_large", TOO_LARGE);
  if (!IMPORT_IMAGE_TYPES.some((type) => type === image.type)) {
    return fail(415, "unsupported", "Use a PNG, JPEG or WebP image.");
  }

  const ai = aiChoice(form?.get("ai"));
  if (!ai) return fail(400, "invalid", "Unknown AI model choice.");
  // Guard against any path that skips the on-device mask; the page always sets it after masking.
  if (ai.provider === "claude" && form?.get("masked") !== "1") {
    return fail(
      400,
      "unmasked",
      "Screenshots go to Claude only after personal details are hidden on this computer. Import again from the portfolio page.",
    );
  }

  const llm = getAi(ai);
  let reading: ScreenshotReading;
  try {
    reading = await readHoldingsFromImage(llm, new Uint8Array(await image.arrayBuffer()));
  } catch (err) {
    const failure = aiFailureResponse(err);
    if (failure) return failure;
    throw err;
  }

  // Misread tickers the provider doesn't list are dropped; ones it couldn't check (provider
  // unreachable) are kept for the review, and saving checks them again.
  const hub = getMarketHub();
  const checked = await hub.verifyListed(reading.holdings.map((h) => h.symbol));
  const holdings = reading.holdings.filter((holding) => checked.get(holding.symbol) !== null);
  if (holdings.length === 0) {
    return fail(
      422,
      "nothing_found",
      "No holdings found. Use a screenshot that shows each stock's ticker, shares and average cost.",
    );
  }

  // Trades are recorded in USD. The model can't always tell ฿ from $ in small print, so also
  // flag costs far above today's price (baht costs are ~33× the dollar price).
  const quotes = await hub.getQuotes(holdings.map((holding) => holding.symbol));
  const farAbove = holdings
    .filter((holding) => {
      const last = quotes.get(holding.symbol)?.lastPrice;
      return holding.averageCost !== null && last != null && holding.averageCost > last * 8;
    })
    .map((holding) => holding.symbol);
  const warning =
    reading.currency && reading.currency !== "USD"
      ? `The costs look like ${reading.currency}. Trades are recorded in USD, so convert the average costs before importing.`
      : farAbove.length > 0
        ? `The average cost of ${farAbove.join(", ")} is far above today's price. If your app shows costs in another currency (such as ฿), convert them to USD before importing.`
        : undefined;
  return Response.json({
    ok: true,
    holdings,
    readBy: llm.displayName,
    warning,
  } satisfies HoldingsReadResult);
}
