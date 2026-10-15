import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useFxHistory } from "./use-fx-history";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("useFxHistory", () => {
  it("reuses loaded rates for a while, then asks again so a new day gets its rate", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: Date.parse("2026-10-15T14:00:00Z") });
    let rate = 36;
    const fetchMock = vi.fn(async () =>
      Response.json({ ok: true, quote: "NOK", rates: { "2026-10-15": rate } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const first = renderHook(() => useFxHistory("NOK", "2026-10-01"));
    await waitFor(() => expect(first.result.current.status).toBe("ready"));
    first.unmount();

    // Same day, an hour later: served from memory.
    vi.setSystemTime(Date.parse("2026-10-15T15:00:00Z"));
    const second = renderHook(() => useFxHistory("NOK", "2026-10-01"));
    await waitFor(() => expect(second.result.current.status).toBe("ready"));
    second.unmount();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // The next New York day: fetched again, and the new rate is used.
    rate = 37;
    vi.setSystemTime(Date.parse("2026-10-16T14:00:00Z"));
    const third = renderHook(() => useFxHistory("NOK", "2026-10-01"));
    await waitFor(() => {
      const state = third.result.current;
      expect(state.status === "ready" && state.rateOn("2026-10-15")).toBe(37);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
