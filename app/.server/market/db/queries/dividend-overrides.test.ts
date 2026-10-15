import { describe, expect, it } from "vitest";

import { setupTestDatabase } from "../../../../../tests/db/test-db";
import {
  clearDividendOverride,
  listDividendOverrides,
  setDividendOverride,
} from "./dividend-overrides";
import { createPortfolio, deletePortfolio } from "./portfolios";

const db = setupTestDatabase();

async function portfolioId(name: string): Promise<string> {
  const result = await createPortfolio(db, name);
  if (!result.ok) throw new Error(result.message);
  return result.portfolio.id;
}

describe("dividend overrides", () => {
  it("keeps one amount per payout, replacing it on a second save, exact to 4 decimals", async () => {
    const id = await portfolioId("Main");
    const key = { portfolioId: id, symbol: "KO", exDate: "2026-06-01" };

    expect(await setDividendOverride(db, { ...key, amount: 12.5 })).toBe(true);
    expect(await setDividendOverride(db, { ...key, amount: 10.6275 })).toBe(true);

    expect(await listDividendOverrides(db, [id])).toEqual([{ ...key, amount: 10.6275 }]);
  });

  it("lists only the portfolios asked about", async () => {
    const main = await portfolioId("Main");
    const other = await portfolioId("Other");
    await setDividendOverride(db, {
      portfolioId: main,
      symbol: "KO",
      exDate: "2026-06-01",
      amount: 1,
    });
    await setDividendOverride(db, {
      portfolioId: other,
      symbol: "KO",
      exDate: "2026-06-01",
      amount: 2,
    });

    expect((await listDividendOverrides(db, [other])).map((row) => row.amount)).toEqual([2]);
    expect(await listDividendOverrides(db, [])).toEqual([]);
  });

  it("clears an entry, reporting whether there was one", async () => {
    const id = await portfolioId("Main");
    const key = { portfolioId: id, symbol: "KO", exDate: "2026-06-01" };
    await setDividendOverride(db, { ...key, amount: 3 });

    expect(await clearDividendOverride(db, key)).toBe(true);
    expect(await clearDividendOverride(db, key)).toBe(false);
    expect(await listDividendOverrides(db, [id])).toEqual([]);
  });

  it("refuses a portfolio that doesn't exist and goes with a deleted portfolio", async () => {
    const id = await portfolioId("Main");
    await setDividendOverride(db, {
      portfolioId: id,
      symbol: "KO",
      exDate: "2026-06-01",
      amount: 3,
    });
    await deletePortfolio(db, id);

    expect(await listDividendOverrides(db, [id])).toEqual([]);
    expect(
      await setDividendOverride(db, {
        portfolioId: id,
        symbol: "KO",
        exDate: "2026-06-01",
        amount: 3,
      }),
    ).toBe(false);
  });

  it("rejects a negative amount at the database level", async () => {
    const id = await portfolioId("Main");
    await expect(
      setDividendOverride(db, { portfolioId: id, symbol: "KO", exDate: "2026-06-01", amount: -1 }),
    ).rejects.toThrow();
  });
});
