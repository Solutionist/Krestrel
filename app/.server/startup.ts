// Server boot sequence, run once per process from app/entry.server.tsx module scope (ADR 0004).

import { env } from "./env";
import { logger } from "./logger";
import { runMigrations } from "./market/db/migrate";
import { getMarketHub } from "./market/instance";

const globalForStartup = globalThis as typeof globalThis & { __krestrelStartup?: Promise<void> };

async function boot(): Promise<void> {
  await runMigrations(env.DATABASE_URL);
  logger.info("database migrations applied");
  const hub = getMarketHub();
  await hub.start();

  const shutdown = (signal: NodeJS.Signals) => {
    logger.info({ signal }, "shutting down market hub");
    // Closes the upstream socket and ends open SSE streams so the HTTP server can close.
    void hub.stop();
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

/** Idempotent across dev HMR re-evaluation of entry.server. */
export function startServer(): Promise<void> {
  globalForStartup.__krestrelStartup ??= boot().catch((err: unknown) => {
    globalForStartup.__krestrelStartup = undefined;
    logger.fatal({ err }, "server startup failed (is Postgres running? `bun run db:up`)");
    throw err;
  });
  return globalForStartup.__krestrelStartup;
}
