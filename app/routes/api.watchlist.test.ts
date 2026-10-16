import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Route } from "./+types/api.watchlist";
import { action } from "./api.watchlist";

const hub = vi.hoisted(() => ({
  addSymbol: vi.fn(),
  removeSymbol: vi.fn(),
  reorder: vi.fn(),
}));

vi.mock("~/.server/market/instance", () => ({ getMarketHub: () => hub }));

function post(body: string, headers: Record<string, string>) {
  const request = new Request("http://127.0.0.1:5173/api/watchlist", {
    method: "POST",
    headers,
    body,
  });
  return action({ request } as Route.ActionArgs);
}

beforeEach(() => {
  vi.clearAllMocks();
  hub.removeSymbol.mockResolvedValue(true);
});

describe("POST /api/watchlist", () => {
  it("refuses a cross-site request", async () => {
    const response = await post(JSON.stringify({ intent: "remove", symbol: "AAPL" }), {
      "Content-Type": "application/json",
      "sec-fetch-site": "cross-site",
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: "cross_site" } });
    expect(hub.removeSymbol).not.toHaveBeenCalled();
  });

  it("rejects a form-encoded body", async () => {
    const response = await post("intent=remove&symbol=AAPL", {
      "Content-Type": "application/x-www-form-urlencoded",
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "invalid" } });
    expect(hub.removeSymbol).not.toHaveBeenCalled();
  });

  it("removes a symbol for a same-origin JSON request", async () => {
    const response = await post(JSON.stringify({ intent: "remove", symbol: "AAPL" }), {
      "Content-Type": "application/json",
      "sec-fetch-site": "same-origin",
    });
    expect(response.status).toBe(200);
    expect(hub.removeSymbol).toHaveBeenCalledWith("AAPL");
  });
});
