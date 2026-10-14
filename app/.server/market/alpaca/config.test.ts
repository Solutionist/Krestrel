import { describe, expect, it } from "vitest";

import { ConfigError } from "../../env-schema";
import { parseAlpacaConfig } from "./config";

describe("parseAlpacaConfig", () => {
  it("names both missing keys and points at the mock provider", () => {
    // Empty values (copied from .env.example) count as unset.
    const parse = () => parseAlpacaConfig({ ALPACA_KEY_ID: "", MARKET_PROVIDER: "alpaca" });
    expect(parse).toThrow(ConfigError);
    expect(parse).toThrow(/ALPACA_KEY_ID/);
    expect(parse).toThrow(/ALPACA_SECRET_KEY: .*MARKET_PROVIDER=mock/);
  });

  it("defaults to the free IEX feed, paper trading host, and appends the feed to the stream URL", () => {
    expect(parseAlpacaConfig({ ALPACA_KEY_ID: "id", ALPACA_SECRET_KEY: "secret" })).toEqual({
      keyId: "id",
      secretKey: "secret",
      feed: "iex",
      tradingUrl: "https://paper-api.alpaca.markets",
      dataUrl: "https://data.alpaca.markets",
      streamUrl: "wss://stream.data.alpaca.markets/v2/iex",
    });
  });

  it("honours overrides and strips trailing slashes", () => {
    const config = parseAlpacaConfig({
      ALPACA_KEY_ID: "id",
      ALPACA_SECRET_KEY: "secret",
      ALPACA_STREAM_FEED: "sip",
      ALPACA_TRADING_URL: "https://api.alpaca.markets/",
      ALPACA_STREAM_URL: "wss://stream.data.alpaca.markets/v2/",
    });
    expect(config.feed).toBe("sip");
    expect(config.tradingUrl).toBe("https://api.alpaca.markets");
    expect(config.streamUrl).toBe("wss://stream.data.alpaca.markets/v2/sip");
  });

  it("accepts the endpoint exactly as Alpaca's dashboard shows it (with /v2)", () => {
    const config = parseAlpacaConfig({
      ALPACA_KEY_ID: "id",
      ALPACA_SECRET_KEY: "secret",
      ALPACA_TRADING_URL: "https://paper-api.alpaca.markets/v2",
      ALPACA_DATA_URL: "https://data.alpaca.markets/v2/",
    });
    expect(config.tradingUrl).toBe("https://paper-api.alpaca.markets");
    expect(config.dataUrl).toBe("https://data.alpaca.markets");
  });

  it("rejects unknown feeds and non-websocket stream URLs without echoing secrets", () => {
    const parse = () =>
      parseAlpacaConfig({
        ALPACA_KEY_ID: "id",
        ALPACA_SECRET_KEY: "super-secret-value",
        ALPACA_STREAM_FEED: "delayed_sip",
        ALPACA_STREAM_URL: "https://stream.data.alpaca.markets/v2",
      });
    expect(parse).toThrow(/ALPACA_STREAM_FEED: must be iex/);
    expect(parse).toThrow(/ALPACA_STREAM_URL: must be a wss:\/\/ URL/);
    expect(parse).not.toThrow(/super-secret-value/);
  });
});
