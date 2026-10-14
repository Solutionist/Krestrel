import { readFileSync } from "node:fs";

import { pino } from "pino";
import { describe, expect, it } from "vitest";

import { parseStreamFrame } from "./schemas";

const log = pino({ level: "silent" });

function fixture(name: string): string {
  return readFileSync(
    new URL(`../../../../tests/fixtures/alpaca/${name}`, import.meta.url),
    "utf8",
  );
}

describe("parseStreamFrame", () => {
  it("returns every message of a batched frame in order", () => {
    const messages = parseStreamFrame(fixture("stream-trades.json"), log);
    expect(messages.map((message) => message.T)).toEqual(["t", "t"]);
  });

  it("keeps optional channel keys optional in subscription confirmations", () => {
    expect(parseStreamFrame('[{"T":"subscription","trades":[],"bars":["FAKEPACA"]}]', log)).toEqual(
      [{ T: "subscription", trades: [], bars: ["FAKEPACA"] }],
    );
  });

  it("skips unknown types and invalid known messages but keeps the rest of the batch", () => {
    const messages = parseStreamFrame(fixture("stream-mixed.json"), log);
    // q (unhandled) and the trade with a string price are dropped.
    expect(messages.map((message) => message.T)).toEqual(["c", "x", "t"]);
  });

  it("returns nothing for frames that are not JSON arrays", () => {
    expect(parseStreamFrame("not json", log)).toEqual([]);
    expect(parseStreamFrame('{"T":"success","msg":"connected"}', log)).toEqual([]);
    expect(parseStreamFrame('[42, {"msg":"no type"}]', log)).toEqual([]);
  });
});
