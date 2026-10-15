import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DisplayCurrency } from "~/hooks/use-currency";
import { formatMoney } from "~/lib/currency";
import type { Trade } from "~/lib/portfolio";

import { PerformancePanel } from "./performance-panel";

// jsdom has no canvas: record what the panel hands to Lightweight Charts instead.
const charts = vi.hoisted(() => ({ series: new Map<string, unknown[]>() }));
vi.mock("lightweight-charts", () => ({
  ColorType: { Solid: "solid" },
  CrosshairMode: { Magnet: 1 },
  LineStyle: { Dashed: 2 },
  LineSeries: "Line",
  createChart: () => ({
    addSeries: (_type: unknown, options: { title: string }) => ({
      setData: (data: unknown[]) => charts.series.set(options.title, data),
    }),
    subscribeCrosshairMove: () => {},
    unsubscribeCrosshairMove: () => {},
    timeScale: () => ({ fitContent: () => {} }),
    remove: () => {},
  }),
}));

const display: DisplayCurrency = {
  currency: "USD",
  selected: "USD",
  setCurrency: () => {},
  fx: { status: "ready", fx: { rates: { USD: 1 }, date: "2026-10-14", source: "ECB" } },
  convert: (usd) => usd,
  money: (usd, signed) => formatMoney(usd, "USD", signed),
};

const TRADES: Trade[] = [
  {
    id: "t1",
    portfolioId: "p1",
    symbol: "AAPL",
    side: "buy",
    shares: 10,
    price: 100,
    fee: 0,
    tradedOn: "2026-10-12",
    createdAt: "2026-10-12T15:00:00Z",
  },
];

const RESPONSE = {
  ok: true,
  today: "2026-10-14",
  closes: {
    AAPL: [
      ["2026-10-12", 100],
      ["2026-10-13", 110],
      ["2026-10-14", 121],
    ],
    SPY: [
      ["2026-10-12", 500],
      ["2026-10-13", 505],
      ["2026-10-14", 510],
    ],
  },
  incomplete: [] as string[],
};

beforeEach(() => charts.series.clear());
afterEach(() => vi.unstubAllGlobals());

describe("PerformancePanel", () => {
  it("charts the portfolio against SPY and sums the period up with ▲/▼", async () => {
    const fetchMock = vi.fn(async () => Response.json(RESPONSE));
    vi.stubGlobal("fetch", fetchMock);
    render(<PerformancePanel portfolioId="p1" trades={TRADES} display={display} />);

    const value = await screen.findByText("Value");
    const stats = value.closest("dl");
    if (!stats) throw new Error("summary missing");
    expect(within(stats).getByText("$1,210.00")).toBeInTheDocument();
    expect(within(stats).getByText(/\+21\.00%/)).toHaveTextContent("▲ up +21.00%");
    expect(within(stats).getByText(/\+2\.00%/)).toHaveTextContent("▲ up +2.00%");
    expect(within(stats).getByText(/pts/)).toHaveTextContent("▲ up +19.00 pts");

    const url = new URL(String(fetchMock.mock.calls[0]?.at(0)), "http://localhost");
    expect(url.pathname).toBe("/api/performance");
    expect(url.searchParams.get("symbols")).toBe("AAPL,SPY");
    expect(url.searchParams.get("from")).toBe("2026-10-12");

    expect(charts.series.get("Portfolio")).toEqual([
      { time: "2026-10-12", value: 1000 },
      { time: "2026-10-13", value: 1100 },
      { time: "2026-10-14", value: 1210 },
    ]);
    expect(charts.series.get("SPY")).toHaveLength(3);

    // A one-month view of a three-day-old portfolio still starts at the first trade.
    const lastMonth = screen.getByRole("button", { name: "Last month" });
    fireEvent.click(lastMonth);
    expect(lastMonth).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(/from the first trade on Oct 12/)).toBeInTheDocument();
  });

  it("says what went wrong when the server can't load prices", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("boom", { status: 500 })),
    );
    render(<PerformancePanel portfolioId="p1" trades={TRADES} display={display} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The Krestrel server couldn't load price history. Check its log.",
    );
  });

  it("names symbols with incomplete history and withholds SPY when its history is missing", async () => {
    // SPY's download failed: its only close is today's price, which would make SPY look flat.
    const response = { ...RESPONSE, closes: { ...RESPONSE.closes, SPY: [["2026-10-14", 510]] } };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ ...response, incomplete: ["SPY"] })),
    );
    render(<PerformancePanel portfolioId="p1" trades={TRADES} display={display} />);

    const stats = (await screen.findByText("Value")).closest("dl");
    if (!stats) throw new Error("summary missing");
    expect(within(stats).getByText("SPY data unavailable")).toBeInTheDocument();
    expect(within(stats).queryByText(/0\.00%/)).not.toBeInTheDocument();
    expect(screen.getByText(/Couldn't download all price history for SPY/)).toBeInTheDocument();
    expect(charts.series.get("SPY")).toEqual([]);
  });

  it("starts the history request at the floor for trades dated earlier", async () => {
    const fetchMock = vi.fn(async () => Response.json(RESPONSE));
    vi.stubGlobal("fetch", fetchMock);
    const old = TRADES.map((trade) => ({ ...trade, tradedOn: "1985-03-04" }));
    render(<PerformancePanel portfolioId="p1" trades={old} display={display} />);

    await screen.findByText("Value");
    const url = new URL(String(fetchMock.mock.calls[0]?.at(0)), "http://localhost");
    expect(url.searchParams.get("from")).toBe("1990-01-01");
  });

  it("asks for a first trade instead of loading anything", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<PerformancePanel portfolioId={null} trades={[]} display={display} />);
    expect(screen.getByText(/No trades yet/)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
