import { describe, expect, it } from "vitest";

import { setupTestDatabase } from "../../../../../tests/db/test-db";
import { createAlert, listActiveAlerts, markAlertTriggered } from "./alerts";
import { addToWatchlist } from "./watchlist";

const db = setupTestDatabase();

describe("alerts", () => {
  it("stores prices exactly at 4 decimals and generates time-ordered ids", async () => {
    await addToWatchlist(db, "AAPL", 30);
    const first = await createAlert(db, { symbol: "AAPL", direction: "above", price: 187.1234 });
    const second = await createAlert(db, { symbol: "AAPL", direction: "below", price: 0.5 });

    expect(first.price).toBe(187.1234);
    expect(second.price).toBe(0.5);
    expect(first.active).toBe(true);
    // uuidv7: version nibble 7, and lexical order follows creation order.
    expect(first.id[14]).toBe("7");
    expect(first.id < second.id).toBe(true);
  });

  it("marks an alert triggered exactly once, even when evaluated concurrently", async () => {
    await addToWatchlist(db, "AAPL", 30);
    const alert = await createAlert(db, { symbol: "AAPL", direction: "above", price: 200 });
    const at = new Date("2026-10-14T14:30:00Z");

    const results = await Promise.all([
      markAlertTriggered(db, alert.id, 200.5, at),
      markAlertTriggered(db, alert.id, 200.6, at),
    ]);

    const fired = results.filter((result) => result !== null);
    expect(fired).toHaveLength(1);
    expect(fired[0]).toMatchObject({ active: false, triggeredAt: at });
    expect(await listActiveAlerts(db)).toEqual([]);
  });

  it("rejects directions other than above/below at the database level", async () => {
    await addToWatchlist(db, "AAPL", 30);
    await expect(
      // @ts-expect-error invalid direction must be refused by the CHECK constraint, not just types
      createAlert(db, { symbol: "AAPL", direction: "sideways", price: 1 }),
    ).rejects.toThrow();
  });
});
