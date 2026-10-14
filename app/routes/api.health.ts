import { sql } from "drizzle-orm";

import { db } from "~/.server/market/db/instance";
import { getMarketHub } from "~/.server/market/instance";

const DB_TIMEOUT_MS = 2000;

/** GET /api/health → 200 when the database answers, 503 otherwise; always reports upstream status. */
export async function loader() {
  const hub = getMarketHub();
  let database: { ok: true } | { ok: false; error: string };
  const timeout = Promise.withResolvers<never>();
  const timer = setTimeout(() => timeout.reject(new Error("timed out")), DB_TIMEOUT_MS);
  try {
    await Promise.race([db.execute(sql`SELECT 1`), timeout.promise]);
    database = { ok: true };
  } catch (err) {
    database = { ok: false, error: err instanceof Error ? err.message : "unreachable" };
  } finally {
    clearTimeout(timer);
  }
  return Response.json(
    { database, upstream: { provider: hub.provider.id, ...hub.status } },
    { status: database.ok ? 200 : 503 },
  );
}
