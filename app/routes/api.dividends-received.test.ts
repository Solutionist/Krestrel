import { describe, expect, it, vi } from "vitest";

import type { Route } from "./+types/api.dividends-received";
import { loader } from "./api.dividends-received";

const getDividendHistory = vi.hoisted(() => vi.fn(async () => new Map()));

vi.mock("~/.server/market/instance", () => ({ getMarketHub: () => ({ getDividendHistory }) }));
vi.mock("~/.server/market/db/instance", () => ({ db: {} }));
vi.mock("~/.server/market/db/queries/dividend-overrides", () => ({
  listDividendOverrides: async () => [],
  setDividendOverride: vi.fn(),
  clearDividendOverride: vi.fn(),
}));

const PORTFOLIO = "0199e3c4-5b6a-7c8d-9e0f-112233445566";

function get(from: string) {
  const params = new URLSearchParams({ symbols: "KO", portfolios: PORTFOLIO, from });
  const request = new Request(`http://127.0.0.1:5173/api/dividends-received?${params}`);
  return loader({ request } as Route.LoaderArgs);
}

describe("GET /api/dividends-received", () => {
  it("rejects a start date before the history floor without asking the provider", async () => {
    const response = await get("0202-05-01");
    expect(response.status).toBe(400);
    expect(getDividendHistory).not.toHaveBeenCalled();
  });

  it("answers from the history floor onward", async () => {
    const response = await get("1990-01-01");
    expect(response.status).toBe(200);
    expect(getDividendHistory).toHaveBeenCalledWith(["KO"], "1990-01-01");
  });
});
