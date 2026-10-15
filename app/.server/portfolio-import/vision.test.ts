import { pino } from "pino";
import { describe, expect, it, vi } from "vitest";

import { ConfigError } from "../env-schema";
import { OllamaError } from "../ollama";
import { cleanHoldings, readHoldingsFromImage } from "./vision";

const logger = pino({ level: "silent" });
const image = new Uint8Array([137, 80, 78, 71]);

function answer(content: unknown): typeof fetch {
  return vi.fn<typeof fetch>(async () =>
    Response.json({ message: { role: "assistant", content: JSON.stringify(content) } }),
  );
}

async function errorOf(promise: Promise<unknown>): Promise<OllamaError> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  if (!(error instanceof OllamaError))
    throw new Error(`expected OllamaError, got ${String(error)}`);
  return error;
}

describe("readHoldingsFromImage", () => {
  it("asks the local model for schema-constrained holdings and returns the cleaned answer", async () => {
    const fetch = answer({
      currency: "usd",
      holdings: [{ symbol: "AAPL", shares: 25, averageCost: 150.25 }],
    });
    await expect(readHoldingsFromImage(image, { env: {}, logger, fetch })).resolves.toEqual({
      holdings: [{ symbol: "AAPL", shares: 25, averageCost: 150.25 }],
      currency: "USD",
    });
    const [url, init] = vi.mocked(fetch).mock.calls[0] ?? [];
    expect(String(url)).toBe("http://127.0.0.1:11434/api/chat");
    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({
      model: "qwen3-vl:8b-instruct",
      stream: false,
      options: { temperature: 0 },
    });
    expect(body.format.properties.holdings.type).toBe("array");
    expect(body.messages.at(-1).images).toEqual([Buffer.from(image).toString("base64")]);
  });

  it("refuses an Ollama URL off this machine, so screenshots can't leave it", async () => {
    const fetch = answer({ currency: null, holdings: [] });
    await expect(
      readHoldingsFromImage(image, {
        env: { OLLAMA_URL: "http://192.168.1.20:11434" },
        logger,
        fetch,
      }),
    ).rejects.toThrow(ConfigError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("explains how to set up Ollama when it isn't running or the model isn't pulled", async () => {
    const refused = vi.fn<typeof fetch>(async () => {
      throw new TypeError("fetch failed");
    });
    const down = await errorOf(readHoldingsFromImage(image, { env: {}, logger, fetch: refused }));
    expect(down.code).toBe("unavailable");
    expect(down.message).toMatch(/ollama pull qwen3-vl:8b-instruct/);

    const missing = vi.fn<typeof fetch>(async () =>
      Response.json({ error: "model 'qwen3-vl:8b-instruct' not found" }, { status: 404 }),
    );
    const notPulled = await errorOf(
      readHoldingsFromImage(image, { env: {}, logger, fetch: missing }),
    );
    expect(notPulled.code).toBe("model_missing");
  });

  it("rejects an answer outside the schema instead of guessing", async () => {
    const offSchema = answer({ positions: ["AAPL"] });
    expect(
      (await errorOf(readHoldingsFromImage(image, { env: {}, logger, fetch: offSchema }))).code,
    ).toBe("invalid_output");
  });

  it("maps the printed currency mark to a code, so non-USD costs can be flagged", async () => {
    const baht = answer({
      currency: "฿",
      holdings: [{ symbol: "KO", shares: 20, averageCost: 2198.3 }],
    });
    const reading = await readHoldingsFromImage(image, { env: {}, logger, fetch: baht });
    expect(reading.currency).toBe("THB");
  });
});

describe("cleanHoldings", () => {
  it("normalises tickers, blanks impossible amounts, and drops unusable rows", () => {
    expect(
      cleanHoldings([
        { symbol: "brk/b", shares: 2, averageCost: 410 },
        { symbol: "$TSLA", shares: 0.5231, averageCost: -3 },
        { symbol: "Apple Inc.", shares: 4, averageCost: 150 },
        { symbol: "MSFT", shares: null, averageCost: null },
      ]),
    ).toEqual([
      { symbol: "BRK.B", shares: 2, averageCost: 410 },
      { symbol: "TSLA", shares: 0.5231, averageCost: null },
    ]);
  });

  it("keeps the fuller reading when a ticker appears twice", () => {
    expect(
      cleanHoldings([
        { symbol: "NVDA", shares: null, averageCost: 98.42 },
        { symbol: "NVDA", shares: 120, averageCost: 98.42 },
      ]),
    ).toEqual([{ symbol: "NVDA", shares: 120, averageCost: 98.42 }]);
  });
});
