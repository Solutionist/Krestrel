import { logger } from "~/.server/logger";
import { db } from "~/.server/market/db/instance";
import { pingDatabase } from "~/.server/market/db/queries/health";
import { getMarketHub } from "~/.server/market/instance";

const DB_TIMEOUT_MS = 2000;

/** GET /api/health → 200 when the database answers, 503 otherwise; always reports upstream status. */
export async function loader() {
  const hub = getMarketHub();
  let database: { ok: true } | { ok: false; error: string };
  const timeout = Promise.withResolvers<never>();
  const timedOut = new Error("timed out");
  const timer = setTimeout(() => timeout.reject(timedOut), DB_TIMEOUT_MS);
  try {
    await Promise.race([pingDatabase(db), timeout.promise]);
    database = { ok: true };
  } catch (err) {
    // Driver errors can carry hosts and user names: log them, never return them.
    logger.warn({ err }, "health check: database unreachable");
    database = { ok: false, error: err === timedOut ? "timed out" : "unreachable" };
  } finally {
    clearTimeout(timer);
  }
  return Response.json(
    { database, upstream: { provider: hub.provider.id, ...hub.status } },
    { status: database.ok ? 200 : 503 },
  );
}
