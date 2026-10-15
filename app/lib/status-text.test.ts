import { describe, expect, it } from "vitest";

import { describeMarket } from "./status-text";

// Wed 21 Oct 2026: New York is on EDT (UTC−4), Bangkok is UTC+7 (11 hours ahead).
const OPEN_WED = Date.UTC(2026, 9, 21, 13, 30); // 09:30 ET = 20:30 Bangkok
const CLOSE_WED = Date.UTC(2026, 9, 21, 20, 0); // 16:00 ET = Thu 03:00 Bangkok

describe("describeMarket", () => {
  it("shows the next open in the viewer's time with New York time alongside", () => {
    const tuesday = Date.UTC(2026, 9, 20, 12, 0);
    const text = describeMarket(
      { phase: "closed", phaseUntil: OPEN_WED, nextOpen: OPEN_WED, nextClose: CLOSE_WED },
      "Asia/Bangkok",
      tuesday,
    );
    expect(text.detail).toBe("opens Wed 20:30 (09:30 ET)");
    expect(text.title).toContain("Asia/Bangkok");
  });

  it("names the day when the change lands on another local day, for both clocks", () => {
    const wednesdayNightBangkok = Date.UTC(2026, 9, 21, 15, 0); // Wed 22:00 Bangkok
    const text = describeMarket(
      { phase: "open", phaseUntil: CLOSE_WED, nextOpen: null, nextClose: CLOSE_WED },
      "Asia/Bangkok",
      wednesdayNightBangkok,
    );
    expect(text.detail).toBe("closes Thu 03:00 (Wed 16:00 ET)");
  });

  it("omits the day for a change later the same local day", () => {
    const wednesdayEveningBangkok = Date.UTC(2026, 9, 21, 11, 0); // Wed 18:00 Bangkok
    expect(
      describeMarket(
        { phase: "pre", phaseUntil: OPEN_WED, nextOpen: OPEN_WED, nextClose: CLOSE_WED },
        "Asia/Bangkok",
        wednesdayEveningBangkok,
      ).detail,
    ).toBe("opens 20:30 (09:30 ET)");
  });

  it("uses New York time only when the zone is unknown (server render) or is New York", () => {
    const clock = {
      phase: "closed" as const,
      phaseUntil: OPEN_WED,
      nextOpen: OPEN_WED,
      nextClose: null,
    };
    const tuesday = Date.UTC(2026, 9, 20, 12, 0);
    expect(describeMarket(clock, null, tuesday).detail).toBe("opens Wed 09:30 ET");
    expect(describeMarket(clock, "America/New_York", tuesday).detail).toBe("opens Wed 09:30 ET");
  });
});
