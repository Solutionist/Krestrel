import postgres from "postgres";

import { runMigrations } from "../../app/.server/market/db/migrate";
import { testDatabaseUrl } from "./url";

/** Creates the throwaway `<db>_test` database on the dev Postgres if needed and migrates it. */
export default async function setup(): Promise<void> {
  const target = new URL(testDatabaseUrl());
  const dbName = target.pathname.slice(1);
  const admin = new URL(target);
  admin.pathname = "/postgres";

  const sql = postgres(admin.toString(), { max: 1, onnotice: () => {} });
  try {
    const [exists] = await sql`SELECT 1 FROM pg_database WHERE datname = ${dbName}`;
    if (!exists) await sql.unsafe(`CREATE DATABASE "${dbName.replaceAll('"', "")}"`);
  } catch (error) {
    throw new Error(
      `Cannot reach Postgres for DB tests at ${target.host}. Start it with \`bun run db:up\`.`,
      { cause: error },
    );
  } finally {
    await sql.end();
  }
  await runMigrations(target.toString());
}
