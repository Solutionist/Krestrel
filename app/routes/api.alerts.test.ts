import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PriceAlert } from "~/lib/alerts";

import type { Route } from "./+types/api.alerts";
import { action } from "./api.alerts";

const alerts = vi.hoisted(() => ({
  create: vi.fn(),
  delete: vi.fn(),
  list: vi.fn(),
}));

vi.mock("~/.server/market/instance", () => ({ getMarketHub: () => ({ alerts }) }));

const ALERT: PriceAlert = {
  id: "0199e3c4-5b6a-7c8d-9e0f-112233445566",
  symbol: "AAPL",
  direction: "above",
  price: 200,
  active: true,
  createdAt: Date.parse("2026-10-14T14:00:00Z"),
  triggeredAt: null,
  triggerPrice: null,
};

function post(body: unknown, headers: Record<string, string> = {}) {
  const request = new Request("http://127.0.0.1:5173/api/alerts", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  return action({ request } as Route.ActionArgs);
}

beforeEach(() => {
  alerts.list.mockResolvedValue([ALERT]);
});

describe("POST /api/alerts", () => {
  it("creates an alert and answers with the updated list", async () => {
    alerts.create.mockResolvedValue({ ok: true, alert: ALERT });
    const response = await post({
      intent: "create",
      symbol: " aapl ",
      direction: "above",
      price: 200,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, alerts: [ALERT] });
    expect(alerts.create).toHaveBeenCalledWith({
      symbol: "AAPL",
      direction: "above",
      price: 200,
    });
  });

  it("rounds the target to the 4 decimals the database stores", async () => {
    alerts.create.mockResolvedValue({ ok: true, alert: ALERT });
    await post({ intent: "create", symbol: "AAPL", direction: "below", price: 0.00016 });

    expect(alerts.create).toHaveBeenCalledWith({
      symbol: "AAPL",
      direction: "below",
      price: 0.0002,
    });
  });

  it.each([
    ["a zero price", { intent: "create", symbol: "AAPL", direction: "above", price: 0 }],
    [
      "a price under 0.0001",
      { intent: "create", symbol: "AAPL", direction: "below", price: 0.00004 },
    ],
    ["a price as text", { intent: "create", symbol: "AAPL", direction: "below", price: "190" }],
    ["an unknown direction", { intent: "create", symbol: "AAPL", direction: "near", price: 1 }],
    ["a bad ticker", { intent: "create", symbol: "APPLE1", direction: "above", price: 1 }],
    ["a malformed id", { intent: "delete", id: "1" }],
    ["broken JSON", "{"],
  ])("refuses %s with 400 and saves nothing", async (_, body) => {
    const response = await post(body);

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ ok: false, error: { code: "invalid" } });
    expect(alerts.create).not.toHaveBeenCalled();
    expect(alerts.delete).not.toHaveBeenCalled();
  });

  it("explains that the symbol must be on the watchlist", async () => {
    const message = "MSFT isn't on your watchlist. Add it first, then set the alert.";
    alerts.create.mockResolvedValue({ ok: false, code: "not_watched", message });

    const response = await post({ intent: "create", symbol: "MSFT", direction: "below", price: 1 });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, error: { code: "not_watched", message } });
  });

  it("answers 404 when deleting an alert that no longer exists", async () => {
    alerts.delete.mockResolvedValue(false);

    const response = await post({ intent: "delete", id: ALERT.id });

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ ok: false, error: { code: "not_found" } });
  });

  it("refuses requests sent by another website", async () => {
    const response = await post(
      { intent: "delete", id: ALERT.id },
      { "Sec-Fetch-Site": "cross-site" },
    );

    expect(response.status).toBe(403);
    expect(alerts.delete).not.toHaveBeenCalled();
  });
});
