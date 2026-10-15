import { describe, expect, it } from "vitest";

import type { Sector } from "~/lib/ideas";

import { setupTestDatabase } from "../../../../../tests/db/test-db";
import { listStockProfiles, saveModelProfiles, saveOwnerProfile } from "./stock-profiles";

const db = setupTestDatabase();

describe("stock profiles", () => {
  it("never lets the model overwrite the owner's correction", async () => {
    await saveModelProfiles(db, [
      { symbol: "AAPL", sector: "Information Technology", style: "growth" },
      { symbol: "KO", sector: "Consumer Staples", style: "growth" },
    ]);
    await saveOwnerProfile(db, { symbol: "KO", sector: "Consumer Staples", style: "dividend" });
    // A later model run (e.g. another page) reclassifies both.
    await saveModelProfiles(db, [
      { symbol: "AAPL", sector: "Information Technology", style: "dividend" },
      { symbol: "KO", sector: "Energy", style: "risky" },
    ]);

    const profiles = await listStockProfiles(db, ["AAPL", "KO", "MSFT"]);
    expect(profiles.sort((a, b) => a.symbol.localeCompare(b.symbol))).toEqual([
      { symbol: "AAPL", sector: "Information Technology", style: "dividend", source: "model" },
      { symbol: "KO", sector: "Consumer Staples", style: "dividend", source: "owner" },
    ]);
  });

  it("keeps a null sector (funds) and returns nothing for no symbols", async () => {
    await saveModelProfiles(db, [{ symbol: "VOO", sector: null, style: "growth" }]);
    expect(await listStockProfiles(db, ["VOO"])).toEqual([
      { symbol: "VOO", sector: null, style: "growth", source: "model" },
    ]);
    expect(await listStockProfiles(db, [])).toEqual([]);
  });

  it("lets the model fill only the type the owner left empty, keeping the owner's sector", async () => {
    // The owner picked a sector while the stock was still unclassified (Ollama was down).
    await saveOwnerProfile(db, { symbol: "RKLB", sector: "Industrials", style: null });
    await saveModelProfiles(db, [{ symbol: "RKLB", sector: "Energy", style: "risky" }]);
    expect(await listStockProfiles(db, ["RKLB"])).toEqual([
      { symbol: "RKLB", sector: "Industrials", style: "risky", source: "owner" },
    ]);
  });

  it("refuses a sector outside the 11 the app can label", async () => {
    const unknown = { symbol: "COIN", sector: "Crypto" as Sector, style: "risky" as const };
    await expect(saveOwnerProfile(db, unknown)).rejects.toThrow();
    expect(await listStockProfiles(db, ["COIN"])).toEqual([]);
  });
});
