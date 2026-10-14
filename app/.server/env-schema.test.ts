import { describe, expect, it } from "vitest";
import * as z from "zod";

import { ConfigError, parseConfig, parseEnv } from "./env-schema";

const VALID = { DATABASE_URL: "postgres://krestrel:krestrel@127.0.0.1:5432/krestrel" };

describe("parseEnv", () => {
  it("applies defaults for optional settings", () => {
    expect(parseEnv(VALID)).toMatchObject({
      LOG_LEVEL: "info",
      MARKET_PROVIDER: "alpaca",
      BACKFILL_DAYS: 30,
    });
  });

  it("treats empty values copied from .env.example as unset", () => {
    expect(parseEnv({ ...VALID, LOG_LEVEL: "", BACKFILL_DAYS: "" })).toMatchObject({
      LOG_LEVEL: "info",
      BACKFILL_DAYS: 30,
    });
  });

  it("lists every problem by variable name without echoing values", () => {
    const secretLookingUrl = "mysql://user:hunter2@db/x";
    let error: unknown;
    try {
      parseEnv({ DATABASE_URL: secretLookingUrl, BACKFILL_DAYS: "-1", LOG_LEVEL: "loud" });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(ConfigError);
    const message = (error as Error).message;
    expect(message).toMatch(/DATABASE_URL/);
    expect(message).toMatch(/BACKFILL_DAYS/);
    expect(message).toMatch(/LOG_LEVEL/);
    expect(message).not.toMatch(/hunter2/);
  });

  it("requires DATABASE_URL", () => {
    expect(() => parseEnv({})).toThrow(/DATABASE_URL/);
  });
});

describe("parseConfig", () => {
  it("labels errors with the config owner, for provider-specific variables", () => {
    const schema = z.object({ API_KEY: z.string() });
    expect(() => parseConfig(schema, {}, "Example provider")).toThrow(
      /Invalid Example provider configuration:\n {2}- API_KEY/,
    );
  });
});
