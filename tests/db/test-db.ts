import { sql } from "drizzle-orm";
import { afterAll, beforeEach } from "vitest";

import { createDatabase, type Database } from "../../app/.server/market/db/client";
import { testDatabaseUrl } from "./url";

/**
 * Connects to the migrated test database and truncates all tables before each test.
 * DB test files run sequentially (fileParallelism off in the `db` project).
 */
export function setupTestDatabase(): Database {
  const db = createDatabase(testDatabaseUrl(), { max: 2 });
  beforeEach(async () => {
    await db.execute(
      sql`TRUNCATE alerts, bars_1m, bars_1d, watchlist, trades, portfolios, stock_profiles`,
    );
  });
  afterAll(async () => {
    await db.$client.end();
  });
  return db;
}
