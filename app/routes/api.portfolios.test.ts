import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Route } from "./+types/api.portfolios";
import { action } from "./api.portfolios";

const hub = vi.hoisted(() => ({
  verifyListed: vi.fn(),
  addSymbol: vi.fn(),
  snapshot: vi.fn(),
}));
const queries = vi.hoisted(() => ({
  addTrades: vi.fn(),
  createPortfolio: vi.fn(),
  deletePortfolio: vi.fn(),
  deleteTrade: vi.fn(),
  renamePortfolio: vi.fn(),
  updateTrade: vi.fn(),
}));

vi.mock("~/.server/market/instance", () => ({ getMarketHub: () => hub }));
vi.mock("~/.server/market/db/queries/portfolios", () => queries);
vi.mock("~/.server/market/db/instance", () => ({ db: {} }));

const PORTFOLIO_ID = "0199e3c4-5b6a-7c8d-9e0f-112233445566";

function addTrade() {
  const request = new Request("http://127.0.0.1:5173/api/portfolios", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      intent: "addTrade",
      portfolioId: PORTFOLIO_ID,
      symbol: "AAPL",
      side: "buy",
      shares: 10,
      price: 187.5,
      tradedOn: "2025-01-02",
    }),
  });
  return action({ request } as Route.ActionArgs);
}

beforeEach(() => {
  vi.clearAllMocks();
  hub.verifyListed.mockResolvedValue(new Map([["AAPL", { symbol: "AAPL" }]]));
  hub.snapshot.mockReturnValue({ watchlist: [] });
  hub.addSymbol.mockResolvedValue({ ok: true });
});

describe("POST /api/portfolios addTrade", () => {
  it("doesn't watch the symbol when the trade is refused", async () => {
    queries.addTrades.mockResolvedValue({
      ok: false,
      code: "oversell",
      message: "You held 0 AAPL then.",
    });
    const response = await addTrade();

    expect(response.status).toBe(409);
    expect(hub.addSymbol).not.toHaveBeenCalled();
  });

  it("watches the symbol after the trade is saved", async () => {
    queries.addTrades.mockResolvedValue({ ok: true });
    const response = await addTrade();

    expect(response.status).toBe(200);
    expect(hub.addSymbol).toHaveBeenCalledWith("AAPL");
    const written = queries.addTrades.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY;
    const watched = hub.addSymbol.mock.invocationCallOrder[0] ?? Number.NEGATIVE_INFINITY;
    expect(written).toBeLessThan(watched);
  });

  it("refuses a symbol that isn't listed without saving", async () => {
    hub.verifyListed.mockResolvedValue(new Map([["AAPL", null]]));
    const response = await addTrade();

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ ok: false, error: { code: "unknown_symbol" } });
    expect(queries.addTrades).not.toHaveBeenCalled();
  });
});
