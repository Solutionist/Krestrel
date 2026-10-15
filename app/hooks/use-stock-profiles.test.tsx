import { act, render, waitFor } from "@testing-library/react";
import { createRoutesStub, useLoaderData } from "react-router";
import { describe, expect, it } from "vitest";

import type { StockProfile } from "~/lib/stock-profile";

import { type StockProfilesState, useStockProfiles } from "./use-stock-profiles";

const saved = (symbol: string): StockProfile => ({
  symbol,
  sector: "Information Technology",
  style: "growth",
  source: "model",
});

describe("useStockProfiles corrections", () => {
  it("drops an aborted correction's unsaved overlay once a newer correction settles", async () => {
    // The stored profiles; the action saves a correction unless a newer one aborted its request.
    const store: Record<string, StockProfile> = { AAPL: saved("AAPL"), MSFT: saved("MSFT") };
    let hook: StockProfilesState | undefined;
    function Page() {
      const profiles = useLoaderData<StockProfile[]>();
      hook = useStockProfiles(profiles, ["AAPL", "MSFT"], "none");
      return null;
    }
    const Stub = createRoutesStub([
      { path: "/", Component: Page, loader: () => Object.values(store) },
      {
        path: "/api/stock-profiles",
        async action({ request }) {
          const body = (await request.json()) as StockProfile;
          await new Promise((resolve) => setTimeout(resolve, body.symbol === "AAPL" ? 50 : 5));
          if (request.signal.aborted) return { ok: false, error: { code: "aborted", message: "" } };
          store[body.symbol] = { ...body, source: "owner" };
          return { ok: true, profiles: [store[body.symbol]] };
        },
      },
    ]);
    render(<Stub initialEntries={["/"]} />);
    await waitFor(() => expect(hook?.profiles.AAPL).toBeDefined());

    act(() => hook?.reclassify("AAPL", { style: "dividend" }));
    act(() => hook?.reclassify("MSFT", { style: "risky" }));
    expect(hook?.profiles.AAPL?.style).toBe("dividend");

    await waitFor(() =>
      expect(hook?.profiles.MSFT).toMatchObject({ style: "risky", source: "owner" }),
    );
    // AAPL's request was aborted, so nothing was stored: the page must show what is stored.
    await waitFor(() => expect(hook?.profiles.AAPL).toEqual(saved("AAPL")));
  });
});
