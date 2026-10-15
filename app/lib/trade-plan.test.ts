import { describe, expect, it } from "vitest";

import type { Analysis, Level } from "./analysis";
import type { Candle } from "./market";
import { buildTradePlan } from "./trade-plan";

/** Candles drifting from `from` to `to` with a fixed 2-point range (ATR ≈ 2). */
function series(from: number, to: number, count = 80): Candle[] {
  return Array.from({ length: count }, (_, i) => {
    const close = from + ((to - from) * i) / (count - 1);
    return { time: i * 60, open: close, high: close + 1, low: close - 1, close, volume: 1 };
  });
}

const level = (id: string, kind: Level["kind"], price: number): Level => ({
  id,
  kind,
  price,
  touches: 3,
  lastTouchTime: 0,
});

function analysis(levels: Level[]): Analysis {
  return { swingThreshold: 0.02, pivots: [], trades: [], levels, trendSupport: null };
}

describe("buildTradePlan", () => {
  it("in an uptrend, buys near the nearest support, stops below the next, targets resistance", () => {
    const candles = series(80, 120);
    const plan = buildTradePlan(
      candles,
      analysis([
        level("S1", "support", 112),
        level("S2", "support", 108),
        level("R1", "resistance", 130),
        level("R2", "resistance", 140),
      ]),
    );
    expect(plan?.bias).toBe("uptrend");
    expect(plan?.buyZone?.basis).toBe("S1 support");
    expect(plan?.buyZone?.low).toBeLessThan(112);
    expect(plan?.buyZone?.high).toBeGreaterThan(112);
    expect(plan?.stop).toMatchObject({ basis: "below S2" });
    expect(plan?.stop?.price).toBeLessThan(108);
    expect(plan?.targets.map((t) => t.price)).toEqual([130, 140]);
    expect(plan?.riskReward).toBeGreaterThan(1);
  });

  it("offers no buy zone in a downtrend, only where a bounce would stall", () => {
    const plan = buildTradePlan(
      series(120, 80),
      analysis([level("S1", "support", 75), level("R1", "resistance", 90)]),
    );
    expect(plan?.bias).toBe("downtrend");
    expect(plan?.buyZone).toBeNull();
    expect(plan?.stop).toBeNull();
    expect(plan?.targets).toEqual([{ price: 90, basis: "R1 resistance" }]);
    expect(plan?.riskReward).toBeNull();
  });

  it("uses a 1-ATR stop when the next support is far away, and the period high without resistance", () => {
    const candles = [...series(80, 130, 60), ...series(130, 120, 20)];
    const plan = buildTradePlan(
      candles,
      analysis([level("S1", "support", 115), level("S2", "support", 60)]),
    );
    expect(plan?.stop?.basis).toBe("1 ATR below the zone");
    expect(plan?.targets[0]).toMatchObject({ basis: "period high" });
    expect(plan?.targets[0]?.price).toBeCloseTo(131, 0);
  });

  it("needs enough candles for an ATR", () => {
    expect(buildTradePlan(series(1, 2, 10), analysis([]))).toBeNull();
  });
});
