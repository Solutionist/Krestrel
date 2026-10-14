import type { Logger } from "pino";

import type { Bar } from "~/lib/market";

import type { Database } from "./db/client";
import { upsertBars } from "./db/queries/bars";

const FLUSH_DELAY_MS = 250;

export interface BarWriter {
  write(bar: Bar): void;
  /** Persists everything queued so far. */
  flush(): Promise<void>;
}

/**
 * Persists live bars. Bars for many symbols arrive together right after each minute mark, so
 * they are coalesced for a short moment and written as one idempotent upsert.
 */
export function createBarWriter(db: Database, logger: Logger): BarWriter {
  let queue: Bar[] = [];
  let timer: NodeJS.Timeout | undefined;
  let inFlight: Promise<void> = Promise.resolve();

  async function persist(batch: Bar[]): Promise<void> {
    try {
      await upsertBars(db, batch);
      logger.debug({ count: batch.length }, "live bars stored");
    } catch (err) {
      // Dropping one minute of IEX bars is recoverable: the next SIP backfill covers it.
      logger.error({ err, count: batch.length }, "failed to store live bars");
    }
  }

  function flush(): Promise<void> {
    clearTimeout(timer);
    timer = undefined;
    const batch = queue;
    queue = [];
    if (batch.length > 0) inFlight = inFlight.then(() => persist(batch));
    return inFlight;
  }

  return {
    write(bar) {
      queue.push(bar);
      timer ??= setTimeout(() => void flush(), FLUSH_DELAY_MS);
    },
    flush,
  };
}
