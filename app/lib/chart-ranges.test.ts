import { describe, expect, it } from "vitest";

import { analysisWindow, rangeStart } from "./chart-ranges";
import type { Candle } from "./market";

const at = (iso: string): Candle => ({
  time: Date.parse(iso) / 1000,
  open: 1,
  high: 1,
  low: 1,
  close: 1,
  volume: 1,
});

describe("rangeStart", () => {
  // Minute-ish candles over Thu Oct 8 … Tue Oct 13 2026 (no weekend data), New York sessions.
  const intraday = [
    at("2026-10-08T14:00:00Z"),
    at("2026-10-08T19:00:00Z"),
    at("2026-10-09T14:00:00Z"),
    at("2026-10-12T14:00:00Z"),
    at("2026-10-13T13:30:00Z"),
    at("2026-10-13T19:59:00Z"),
  ];

  it("1D starts at the first candle of the latest session, even when that is not today", () => {
    expect(rangeStart("1D", intraday)).toBe(at("2026-10-13T13:30:00Z").time);
  });

  it("5D counts trading sessions in the data, skipping the weekend", () => {
    // Only 4 sessions exist: falls back to the earliest one.
    expect(rangeStart("5D", intraday)).toBe(at("2026-10-08T14:00:00Z").time);
    expect(rangeStart("5D", intraday.slice(2))).toBe(at("2026-10-09T14:00:00Z").time);
  });

  const daily = [
    at("2025-10-14T04:00:00Z"),
    at("2026-01-02T05:00:00Z"),
    at("2026-07-14T04:00:00Z"),
    at("2026-08-14T04:00:00Z"),
    at("2026-09-14T04:00:00Z"),
    at("2026-10-14T04:00:00Z"),
  ];

  it("month and year ranges are calendar-based from the latest candle", () => {
    expect(rangeStart("1M", daily)).toBe(at("2026-09-14T04:00:00Z").time);
    expect(rangeStart("3M", daily)).toBe(at("2026-07-14T04:00:00Z").time);
    expect(rangeStart("YTD", daily)).toBe(at("2026-01-02T05:00:00Z").time);
    expect(rangeStart("1Y", daily)).toBe(at("2025-10-14T04:00:00Z").time);
  });

  it("All shows everything; no data means nothing to zoom", () => {
    expect(rangeStart("All", daily)).toBeNull();
    expect(rangeStart("1M", [])).toBeNull();
  });

  it("clamps month arithmetic to short months (Mar 31 − 1 month → Feb 28)", () => {
    const candles = [
      at("2026-02-27T05:00:00Z"),
      at("2026-03-02T05:00:00Z"),
      at("2026-03-31T04:00:00Z"),
    ];
    expect(rangeStart("1M", candles)).toBe(at("2026-03-02T05:00:00Z").time);
  });
});

describe("analysisWindow", () => {
  it("keeps only the interval's period, so older loaded history doesn't leak into Insights", () => {
    const daily = Array.from({ length: 800 }, (_, i) =>
      at(new Date(Date.UTC(2024, 0, 2 + i, 5)).toISOString()),
    );
    const window = analysisWindow(daily, "1D");
    const last = daily.at(-1);
    expect(window.at(-1)).toBe(last);
    // 1D interval → last year.
    expect(window.length).toBeGreaterThan(360);
    expect(window.length).toBeLessThan(370);
  });

  it("caps very long windows to the newest candles", () => {
    const minutes = Array.from({ length: 9000 }, (_, i) =>
      at(new Date(Date.UTC(2026, 9, 13, 13, 30) + i * 60_000).toISOString()),
    );
    expect(analysisWindow(minutes, "1M")).toHaveLength(6000);
  });
});
