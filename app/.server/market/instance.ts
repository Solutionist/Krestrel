// The process-wide MarketHub (ADR 0004). Import `getMarketHub` from here; never construct a
// provider or hub elsewhere, or a second upstream connection will be opened.

import { env } from "../env";
import { logger } from "../logger";
import { db } from "./db/instance";
import { MarketHub } from "./hub";
import { createProvider } from "./registry";

// Stored on globalThis so dev HMR re-evaluating modules reuses the live hub and its socket.
const globalForHub = globalThis as typeof globalThis & { __krestrelHub?: MarketHub };

/** Returns the singleton hub, creating and starting it on first use (start is idempotent). */
export function getMarketHub(): MarketHub {
  let hub = globalForHub.__krestrelHub;
  if (!hub) {
    const provider = createProvider(env.MARKET_PROVIDER, { env: process.env, logger });
    hub = new MarketHub({
      provider,
      db,
      logger,
      backfillDays: env.BACKFILL_DAYS,
      dailyHistoryYears: env.DAILY_HISTORY_YEARS,
    });
    globalForHub.__krestrelHub = hub;
    logger.info({ provider: provider.id }, "market hub created");
  }
  void hub.start().catch((err: unknown) => logger.fatal({ err }, "market hub failed to start"));
  return hub;
}
