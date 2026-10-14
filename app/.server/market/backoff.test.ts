import { describe, expect, it } from "vitest";

import { backoffDelay } from "./backoff";

const almostOne = () => 0.999_999;

describe("backoffDelay", () => {
  it("doubles the ceiling per attempt from the base", () => {
    expect(backoffDelay(0, { random: almostOne })).toBe(999);
    expect(backoffDelay(1, { random: almostOne })).toBe(1_999);
    expect(backoffDelay(3, { random: almostOne })).toBe(7_999);
  });

  it("never exceeds the cap however many attempts failed", () => {
    expect(backoffDelay(6, { random: almostOne })).toBe(59_999);
    expect(backoffDelay(50, { random: almostOne })).toBe(59_999);
    expect(backoffDelay(4, { baseMs: 500, capMs: 2_000, random: almostOne })).toBe(1_999);
  });

  it("jitters across the whole range down to zero", () => {
    expect(backoffDelay(5, { random: () => 0 })).toBe(0);
    expect(backoffDelay(2, { random: () => 0.5 })).toBe(2_000);
  });
});
