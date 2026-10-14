import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema";

export type Database = PostgresJsDatabase<typeof schema> & { $client: postgres.Sql };

type ClientOptions = NonNullable<Parameters<typeof postgres>[1]>;

/** Pure factory (no env access) so tests and scripts can target any database. */
export function createDatabase(url: string, options: ClientOptions = {}): Database {
  const client = postgres(url, { max: 10, idle_timeout: 30, onnotice: () => {}, ...options });
  return drizzle({ client, schema });
}
