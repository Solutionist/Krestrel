import { describe, expect, it } from "vitest";

import { ConfigError } from "../env-schema";
import type { ProviderContext } from "./provider";
import { createProvider } from "./registry";

describe("createProvider", () => {
  it("rejects names inherited from Object.prototype", () => {
    const create = () => createProvider("constructor", {} as ProviderContext);
    expect(create).toThrow(ConfigError);
    expect(create).toThrow(/Unknown MARKET_PROVIDER "constructor"/);
  });
});
