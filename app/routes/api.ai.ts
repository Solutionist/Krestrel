import * as z from "zod";

import { aiEnabled, aiFailureResponse, getWebSearch } from "~/.server/llm/instance";
import { listLocalModels, pullLocalModel } from "~/.server/llm/local-models";
import { logger } from "~/.server/logger";
import { crossSiteRejection } from "~/.server/same-origin";
import { type AiStatus, LocalModelIdSchema } from "~/lib/ai";

import type { Route } from "./+types/api.ai";

/** GET /api/ai → what the AI settings can offer: Claude, local models (installed or suggested), Tavily. */
export async function loader() {
  try {
    const local = await listLocalModels({ env: process.env, logger });
    return Response.json({
      ok: true,
      claude: { enabled: aiEnabled() },
      local,
      tavily: { configured: getWebSearch() !== null },
    } satisfies AiStatus);
  } catch (err) {
    const failure = aiFailureResponse(err);
    if (failure) return failure;
    throw err;
  }
}

const PullSchema = z.object({ intent: z.literal("pull"), model: LocalModelIdSchema });

/**
 * POST /api/ai { intent: "pull", model } → downloads a local model through Ollama, streaming its
 * progress as newline-delimited JSON (`{status, completed?, total?}`, then `{status:"success"}` or
 * `{error}`). Same-origin only.
 */
export async function action({ request }: Route.ActionArgs) {
  const refused = crossSiteRejection(request);
  if (refused) return refused;
  const parsed = PullSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { ok: false, error: { code: "invalid", message: "Name a model to download." } },
      { status: 400 },
    );
  }
  try {
    // Leaving the page stops the download request; Ollama keeps what it already fetched.
    const progress = await pullLocalModel(parsed.data.model, {
      env: process.env,
      signal: request.signal,
    });
    return new Response(progress, {
      headers: { "content-type": "application/x-ndjson", "cache-control": "no-cache" },
    });
  } catch (err) {
    logger.warn({ err, model: parsed.data.model }, "model download failed to start");
    return Response.json(
      {
        ok: false,
        error: {
          code: "unavailable",
          message: "Couldn't reach Ollama to download the model. Is Ollama installed and running?",
        },
      },
      { status: 503 },
    );
  }
}
