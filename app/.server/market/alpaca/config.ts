import * as z from "zod";

import { parseConfig } from "../../env-schema";

const MISSING_KEYS =
  "is required. Set ALPACA_KEY_ID and ALPACA_SECRET_KEY in .env (free paper-account keys work), or use MARKET_PROVIDER=mock.";

const AlpacaEnvSchema = z.object({
  ALPACA_KEY_ID: z.string({ error: MISSING_KEYS }).trim().min(1, { error: MISSING_KEYS }),
  ALPACA_SECRET_KEY: z.string({ error: MISSING_KEYS }).trim().min(1, { error: MISSING_KEYS }),
  ALPACA_STREAM_FEED: z
    .enum(["iex", "sip"], { error: "must be iex (free plan) or sip (paid plan)" })
    .default("iex"),
  ALPACA_TRADING_URL: z.httpUrl().default("https://paper-api.alpaca.markets"),
  ALPACA_DATA_URL: z.httpUrl().default("https://data.alpaca.markets"),
  ALPACA_STREAM_URL: z
    .url({ protocol: /^wss?$/, error: "must be a wss:// URL" })
    .default("wss://stream.data.alpaca.markets/v2"),
});

export type AlpacaFeed = z.output<typeof AlpacaEnvSchema>["ALPACA_STREAM_FEED"];

export interface AlpacaConfig {
  keyId: string;
  secretKey: string;
  feed: AlpacaFeed;
  tradingUrl: string;
  dataUrl: string;
  /** Full stream URL including the feed path, e.g. wss://stream.data.alpaca.markets/v2/iex. */
  streamUrl: string;
}

/**
 * REST base URL without a trailing slash or API version. Alpaca's dashboard shows the endpoint
 * as `https://paper-api.alpaca.markets/v2`; the provider adds `/v2/…` or `/v3/…` per request.
 */
function restBase(url: string): string {
  return url.replace(/\/+$/, "").replace(/\/v\d+$/, "");
}

/** Validates the Alpaca-owned variables; throws `ConfigError` naming every bad variable. */
export function parseAlpacaConfig(env: Readonly<Record<string, string | undefined>>): AlpacaConfig {
  const parsed = parseConfig(AlpacaEnvSchema, env, "Alpaca provider");
  return {
    keyId: parsed.ALPACA_KEY_ID,
    secretKey: parsed.ALPACA_SECRET_KEY,
    feed: parsed.ALPACA_STREAM_FEED,
    tradingUrl: restBase(parsed.ALPACA_TRADING_URL),
    dataUrl: restBase(parsed.ALPACA_DATA_URL),
    streamUrl: `${parsed.ALPACA_STREAM_URL.replace(/\/+$/, "")}/${parsed.ALPACA_STREAM_FEED}`,
  };
}
