import { describe, expect, it } from "vitest";

import { setupTestDatabase } from "../../../../../tests/db/test-db";
import { listTargets, replaceTargets } from "./portfolio-targets";
import { createPortfolio, deletePortfolio } from "./portfolios";

const db = setupTestDatabase();

async function portfolio(name: string): Promise<string> {
  const created = await createPortfolio(db, name);
  if (!created.ok) throw new Error(created.message);
  return created.portfolio.id;
}

describe("portfolio targets", () => {
  it("replaces the whole set and keeps each portfolio's targets apart", async () => {
    const main = await portfolio("Main");
    const other = await portfolio("Other");
    await replaceTargets(db, main, [
      { symbol: "AAPL", weight: 40 },
      { symbol: "MSFT", weight: 35.125 },
    ]);
    await replaceTargets(db, other, [{ symbol: "KO", weight: 100 }]);
    expect(
      await replaceTargets(db, main, [
        { symbol: "VOO", weight: 60.5 },
        { symbol: "AAPL", weight: 20 },
        { symbol: "BRK.B", weight: 20 },
      ]),
    ).toBe(true);

    expect(await listTargets(db, main)).toEqual([
      { symbol: "VOO", weight: 60.5 },
      { symbol: "AAPL", weight: 20 },
      { symbol: "BRK.B", weight: 20 },
    ]);
    expect(await listTargets(db, other)).toEqual([{ symbol: "KO", weight: 100 }]);
  });

  it("clears the targets with an empty list", async () => {
    const id = await portfolio("Main");
    await replaceTargets(db, id, [{ symbol: "AAPL", weight: 50 }]);
    await replaceTargets(db, id, []);
    expect(await listTargets(db, id)).toEqual([]);
  });

  it("refuses an unknown portfolio and saves nothing", async () => {
    const missing = "01900000-0000-7000-8000-000000000000";
    expect(await replaceTargets(db, missing, [{ symbol: "AAPL", weight: 50 }])).toBe(false);
    expect(await listTargets(db, missing)).toEqual([]);
  });

  it("keeps the previous targets when a save fails part-way", async () => {
    const id = await portfolio("Main");
    await replaceTargets(db, id, [{ symbol: "AAPL", weight: 50 }]);
    await expect(
      replaceTargets(db, id, [
        { symbol: "MSFT", weight: 30 },
        { symbol: "KO", weight: 0 },
      ]),
    ).rejects.toThrow();
    expect(await listTargets(db, id)).toEqual([{ symbol: "AAPL", weight: 50 }]);
  });

  it("removes the targets with their portfolio", async () => {
    const id = await portfolio("Main");
    await replaceTargets(db, id, [{ symbol: "AAPL", weight: 50 }]);
    await deletePortfolio(db, id);
    expect(await listTargets(db, id)).toEqual([]);
    // The id is free again: saving to it now fails as unknown.
    expect(await replaceTargets(db, id, [{ symbol: "AAPL", weight: 50 }])).toBe(false);
  });
});
