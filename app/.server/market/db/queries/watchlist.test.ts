import { describe, expect, it } from "vitest";

import { setupTestDatabase } from "../../../../../tests/db/test-db";
import { createAlert, listAlerts } from "./alerts";
import { addToWatchlist, listWatchlist, removeFromWatchlist, reorderWatchlist } from "./watchlist";

const db = setupTestDatabase();

describe("watchlist", () => {
  it("appends symbols in order and rejects duplicates", async () => {
    await addToWatchlist(db, "AAPL", 30);
    await addToWatchlist(db, "MSFT", 30);
    const duplicate = await addToWatchlist(db, "AAPL", 30);

    expect(duplicate).toMatchObject({ ok: false, code: "duplicate" });
    expect((await listWatchlist(db)).map((entry) => entry.symbol)).toEqual(["AAPL", "MSFT"]);
  });

  it("enforces the provider symbol limit, including under concurrent adds", async () => {
    await addToWatchlist(db, "AAPL", 2);
    const results = await Promise.all([
      addToWatchlist(db, "MSFT", 2),
      addToWatchlist(db, "NVDA", 2),
      addToWatchlist(db, "TSLA", 2),
    ]);

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok && result.code === "limit")).toHaveLength(2);
    expect(await listWatchlist(db)).toHaveLength(2);
  });

  it("allows the 30th symbol and refuses the 31st with a message that says what to do", async () => {
    for (let index = 0; index < 30; index++) {
      const result = await addToWatchlist(
        db,
        `S${String.fromCharCode(65 + (index % 26))}${index}`,
        30,
      );
      expect(result.ok).toBe(true);
    }
    const overflow = await addToWatchlist(db, "ONEMORE", 30);
    expect(overflow).toMatchObject({ ok: false, code: "limit" });
    expect(overflow.ok ? "" : overflow.message).toMatch(/Remove one/);
  });

  it("reuses free positions at the end after removal and cascades alerts", async () => {
    await addToWatchlist(db, "AAPL", 30);
    await addToWatchlist(db, "MSFT", 30);
    await createAlert(db, { symbol: "AAPL", direction: "above", price: 200 });

    expect(await removeFromWatchlist(db, "AAPL")).toBe(true);
    expect(await removeFromWatchlist(db, "AAPL")).toBe(false);
    expect(await listAlerts(db)).toEqual([]);

    await addToWatchlist(db, "NVDA", 30);
    expect((await listWatchlist(db)).map((entry) => entry.symbol)).toEqual(["MSFT", "NVDA"]);
  });

  it("reorders only when given an exact permutation of the current list", async () => {
    for (const symbol of ["AAPL", "MSFT", "NVDA"]) await addToWatchlist(db, symbol, 30);

    expect(await reorderWatchlist(db, ["NVDA", "AAPL"])).toBe(false);
    expect(await reorderWatchlist(db, ["NVDA", "AAPL", "AAPL"])).toBe(false);
    expect(await reorderWatchlist(db, ["NVDA", "AAPL", "TSLA"])).toBe(false);
    expect(await reorderWatchlist(db, ["NVDA", "AAPL", "MSFT"])).toBe(true);
    expect((await listWatchlist(db)).map((entry) => entry.symbol)).toEqual([
      "NVDA",
      "AAPL",
      "MSFT",
    ]);
  });
});
