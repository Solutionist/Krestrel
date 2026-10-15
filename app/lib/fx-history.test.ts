import { afterEach, describe, expect, it, vi } from "vitest";

import { FxHistoryQuerySchema, rateOnDay, shiftDay } from "./fx-history";

describe("rateOnDay", () => {
  const rateOn = rateOnDay({ "2024-03-04": 36.1, "2024-03-01": 35.9, "2024-03-05": 36.3 });

  it("uses the day's own rate when published", () => {
    expect(rateOn?.("2024-03-04")).toBe(36.1);
    expect(rateOn?.("2024-03-05")).toBe(36.3);
  });

  it("uses the latest earlier rate on weekends, holidays and after the last publication", () => {
    expect(rateOn?.("2024-03-02")).toBe(35.9);
    expect(rateOn?.("2024-03-03")).toBe(35.9);
    expect(rateOn?.("2024-03-09")).toBe(36.3);
  });

  it("uses the first rate for a day before any publication", () => {
    expect(rateOn?.("2024-02-28")).toBe(35.9);
  });

  it("is null without rates", () => {
    expect(rateOnDay({})).toBeNull();
  });
});

describe("rateOnDay across a publication gap", () => {
  // The ECB published no ISK rate from 2008-12-03 to 2018-02-01.
  const rateOn = rateOnDay({ "2008-12-02": 120, "2018-02-02": 102 });

  it("has no rate for a day long after the last publication before it", () => {
    expect(rateOn?.("2010-06-15")).toBeNull();
  });

  it("still uses the previous rate within a holiday-length gap", () => {
    expect(rateOn?.("2008-12-12")).toBe(120);
  });
});

describe("shiftDay", () => {
  it("crosses month and year ends", () => {
    expect(shiftDay("2024-03-01", -1)).toBe("2024-02-29");
    expect(shiftDay("2025-01-05", -10)).toBe("2024-12-26");
  });
});

describe("FxHistoryQuerySchema", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("accepts a currency code and a start from 1999 up to today (New York)", () => {
    vi.useFakeTimers({ now: Date.parse("2026-10-15T15:00:00Z") });
    expect(FxHistoryQuerySchema.safeParse({ quote: "THB", from: "1999-01-01" }).success).toBe(true);
    expect(FxHistoryQuerySchema.safeParse({ quote: "THB", from: "2026-10-15" }).success).toBe(true);
  });

  it("refuses a lowercase or long code, a bad date, a start before 1999 or in the future", () => {
    vi.useFakeTimers({ now: Date.parse("2026-10-15T15:00:00Z") });
    for (const query of [
      { quote: "thb", from: "2024-01-01" },
      { quote: "THBX", from: "2024-01-01" },
      { quote: "THB", from: "2024-13-01" },
      { quote: "THB", from: "1998-12-31" },
      { quote: "THB", from: "2026-10-16" },
      { quote: "THB" },
    ]) {
      expect(FxHistoryQuerySchema.safeParse(query).success, JSON.stringify(query)).toBe(false);
    }
  });
});
