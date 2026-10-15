import { describe, expect, it, vi } from "vitest";

import { PerformanceResponseSchema } from "~/lib/performance";

import type { Route } from "./+types/api.performance";
import { loader } from "./api.performance";

const getDailyCloses = vi.hoisted(() =>
  vi.fn(async () => ({ closes: new Map([["KO", [["1990-01-02", 9]]]]), incomplete: ["KO"] })),
);

vi.mock("~/.server/market/instance", () => ({ getMarketHub: () => ({ getDailyCloses }) }));

function get(from: string) {
  const params = new URLSearchParams({ symbols: "KO", from });
  const request = new Request(`http://127.0.0.1:5173/api/performance?${params}`);
  return loader({ request } as Route.LoaderArgs);
}

describe("GET /api/performance", () => {
  it("rejects a start date before the history floor without asking the provider", async () => {
    const response = await get("0202-05-01");
    expect(response.status).toBe(400);
    expect(getDailyCloses).not.toHaveBeenCalled();
  });

  it("answers from the history floor onward and names symbols with incomplete history", async () => {
    const response = await get("1990-01-01");
    expect(response.status).toBe(200);
    expect(getDailyCloses).toHaveBeenCalledWith(["KO"], "1990-01-01");
    const body = PerformanceResponseSchema.parse(await response.json());
    expect(body.ok && body.incomplete).toEqual(["KO"]);
  });
});
