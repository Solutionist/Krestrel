import { describe, expect, it } from "vitest";

import type { TradeInput } from "~/lib/portfolio";

import { setupTestDatabase } from "../../../../../tests/db/test-db";
import {
  addTrades,
  createPortfolio,
  deletePortfolio,
  deleteTrade,
  listPortfolios,
  listTrades,
  renamePortfolio,
  updateTrade,
} from "./portfolios";

const db = setupTestDatabase();

async function portfolio(name: string): Promise<string> {
  const result = await createPortfolio(db, name);
  if (!result.ok) throw new Error(result.message);
  return result.portfolio.id;
}

const buy = (shares: number, tradedOn: string): TradeInput => ({
  symbol: "AAPL",
  side: "buy",
  shares,
  price: 100,
  fee: 0,
  tradedOn,
});
const sell = (shares: number, tradedOn: string): TradeInput => ({
  ...buy(shares, tradedOn),
  side: "sell",
});

describe("portfolios", () => {
  it("keeps names unique ignoring case, for create and rename", async () => {
    const id = await portfolio("Long term");
    await portfolio("Dime");

    expect(await createPortfolio(db, "long TERM")).toMatchObject({ ok: false, code: "duplicate" });
    expect(await renamePortfolio(db, id, "dime")).toMatchObject({ ok: false, code: "duplicate" });
    expect(await renamePortfolio(db, id, "Long Term")).toMatchObject({ ok: true });
    expect((await listPortfolios(db)).map((entry) => entry.name)).toEqual(["Long Term", "Dime"]);
  });

  it("deletes a portfolio's trades with it", async () => {
    const id = await portfolio("Main");
    await addTrades(db, id, [buy(1, "2026-01-02")]);

    expect(await deletePortfolio(db, id)).toBe(true);
    expect(await listTrades(db)).toEqual([]);
  });
});

describe("trades", () => {
  it("round-trips fractional shares and fees", async () => {
    const id = await portfolio("Main");
    await addTrades(db, id, [{ ...buy(0.123456, "2026-01-02"), price: 187.1234, fee: 1.5 }]);

    expect(await listTrades(db)).toMatchObject([
      { symbol: "AAPL", side: "buy", shares: 0.123456, price: 187.1234, fee: 1.5 },
    ]);
  });

  it("refuses a sell of more than was held on that date, per portfolio", async () => {
    const main = await portfolio("Main");
    const other = await portfolio("Other");
    await addTrades(db, main, [buy(5, "2026-01-10")]);

    expect(await addTrades(db, main, [sell(5, "2026-01-05")])).toMatchObject({
      ok: false,
      code: "oversell",
    });
    expect(await addTrades(db, other, [sell(1, "2026-02-01")])).toMatchObject({
      ok: false,
      code: "oversell",
    });
    expect(await addTrades(db, main, [sell(5, "2026-02-01")])).toEqual({ ok: true });
  });

  it("saves a batch (a screenshot import) all or nothing", async () => {
    const id = await portfolio("Main");
    const msft = { ...buy(2, "2026-01-02"), symbol: "MSFT" };

    expect(
      await addTrades(db, id, [buy(3, "2026-01-02"), msft, sell(9, "2026-01-05")]),
    ).toMatchObject({ ok: false, code: "oversell" });
    expect(await listTrades(db)).toEqual([]);

    expect(await addTrades(db, id, [buy(3, "2026-01-02"), msft])).toEqual({ ok: true });
    expect((await listTrades(db)).map((trade) => trade.symbol).sort()).toEqual(["AAPL", "MSFT"]);
  });

  it("refuses edits and deletes that would leave a later sell uncovered", async () => {
    const id = await portfolio("Main");
    await addTrades(db, id, [buy(5, "2026-01-02")]);
    await addTrades(db, id, [sell(4, "2026-02-01")]);
    const buyId = (await listTrades(db)).find((trade) => trade.side === "buy")?.id ?? "";

    expect(await deleteTrade(db, buyId)).toMatchObject({ ok: false, code: "oversell" });
    expect(await updateTrade(db, buyId, buy(3, "2026-01-02"))).toMatchObject({
      ok: false,
      code: "oversell",
    });
    expect(await updateTrade(db, buyId, buy(6, "2026-01-03"))).toEqual({ ok: true });
    expect((await listTrades(db)).find((trade) => trade.id === buyId)).toMatchObject({
      shares: 6,
      tradedOn: "2026-01-03",
    });
  });

  it("serializes concurrent sells so they can't both spend the same shares", async () => {
    const id = await portfolio("Main");
    await addTrades(db, id, [buy(5, "2026-01-02")]);

    const results = await Promise.all([
      addTrades(db, id, [sell(4, "2026-02-01")]),
      addTrades(db, id, [sell(4, "2026-02-01")]),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
  });

  it("reports missing trades and portfolios", async () => {
    const missing = "00000000-0000-7000-8000-000000000000";
    expect(await addTrades(db, missing, [buy(1, "2026-01-02")])).toMatchObject({
      code: "not_found",
    });
    expect(await deleteTrade(db, missing)).toMatchObject({ code: "not_found" });
  });
});
