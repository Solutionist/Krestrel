import { env } from "../../env";
import { createDatabase, type Database } from "./client";

// Cached on globalThis so dev HMR re-evaluating this module reuses one pool instead of leaking one per edit.
const globalForDb = globalThis as typeof globalThis & { __krestrelDb?: Database };

/** The app's database connection pool. */
export const db: Database = globalForDb.__krestrelDb ?? createDatabase(env.DATABASE_URL);
globalForDb.__krestrelDb = db;
