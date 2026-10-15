import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { PriceAlert } from "~/lib/alerts";

import { useAlerts } from "./use-alerts";

afterEach(() => {
  vi.unstubAllGlobals();
});

function alert(id: string): PriceAlert {
  return {
    id,
    symbol: "AAPL",
    direction: "above",
    price: 200,
    active: true,
    createdAt: Date.parse("2026-10-14T14:00:00Z"),
    triggeredAt: null,
    triggerPrice: null,
  };
}

const A = alert("8f9c1a52-6a0e-4d4a-9a53-2f1f4b1d1a01");
const B = alert("8f9c1a52-6a0e-4d4a-9a53-2f1f4b1d1a02");

/** fetch whose answers the test releases one by one, in any order (by call number). */
function controlledFetch() {
  const pending: ((response: Response) => void)[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      const { promise, resolve } = Promise.withResolvers<Response>();
      pending.push(resolve);
      return promise;
    }),
  );
  return {
    count: () => pending.length,
    answer(call: number, body: unknown, status = 200) {
      const resolve = pending[call];
      if (!resolve) throw new Error(`fetch call ${call} wasn't made`);
      resolve(Response.json(body, { status }));
    },
  };
}

describe("useAlerts", () => {
  it("removes an alert on a double-clicked ×, without an error, even when the second delete gets 404", async () => {
    const calls = controlledFetch();
    const { result } = renderHook(() =>
      useAlerts({ onAlert: () => () => {}, watchlist: ["AAPL"], link: "open" }),
    );
    await act(async () => calls.answer(0, { ok: true, alerts: [A, B] }));
    await waitFor(() => expect(result.current.alerts).toEqual([A, B]));

    let first: Promise<void> | undefined;
    let second: Promise<void> | undefined;
    act(() => {
      first = result.current.remove(A.id);
      second = result.current.remove(A.id);
    });
    await act(async () => {
      calls.answer(1, { ok: true, alerts: [B] });
      await first;
    });
    await act(async () => {
      calls.answer(
        2,
        { ok: false, error: { code: "not_found", message: "That alert no longer exists." } },
        404,
      );
      await second;
    });
    // The 404 reloads the list.
    await waitFor(() => expect(calls.count()).toBe(4));
    await act(async () => calls.answer(3, { ok: true, alerts: [B] }));

    await waitFor(() => expect(result.current.alerts).toEqual([B]));
    expect(result.current.error).toBeNull();
  });

  it("keeps a created alert when a reload sent earlier answers after it", async () => {
    const calls = controlledFetch();
    const { result } = renderHook(() =>
      useAlerts({ onAlert: () => () => {}, watchlist: ["AAPL"], link: "open" }),
    );

    let created: Promise<boolean> | undefined;
    act(() => {
      created = result.current.create({ symbol: "AAPL", direction: "above", price: 200 });
    });
    await act(async () => {
      calls.answer(1, { ok: true, alerts: [A] });
      expect(await created).toBe(true);
    });
    await act(async () => calls.answer(0, { ok: true, alerts: [] }));

    expect(result.current.alerts).toEqual([A]);
  });
});
