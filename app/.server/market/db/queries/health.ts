import { sql } from "drizzle-orm";

import type { Database } from "../client";

/** Resolves when the database answers a trivial query; rejects with the driver error otherwise. */
export async function pingDatabase(db: Database): Promise<void> {
  await db.execute(sql`SELECT 1`);
}
