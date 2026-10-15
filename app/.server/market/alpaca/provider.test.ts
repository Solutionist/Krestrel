import { readFileSync } from "node:fs";

import { pino } from "pino";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Bar, ConnectionStatus, Tick } from "~/lib/market";

import type { AlpacaDeps, AlpacaSocket, AlpacaSocketEvents } from "./provider";
import { createAlpacaProvider } from "./provider";
import { AssetResponseSchema } from "./schemas";

function fixture(name: string): string {
  return readFileSync(
    new URL(`../../../../tests/fixtures/alpaca/${name}`, import.meta.url),
    "utf8",
  );
}

const ENV = { ALPACA_KEY_ID: "test-key-id", ALPACA_SECRET_KEY: "test-secret" };

class FakeSocket implements AlpacaSocket {
  readonly sent: unknown[] = [];
  closed = false;

  constructor(
    readonly url: string,
    private readonly events: AlpacaSocketEvents,
  ) {}

  send(data: string): void {
    this.sent.push(JSON.parse(data));
  }

  close(): void {
    this.closed = true;
  }

  receive(fixtureName: string): void {
    this.receiveText(fixture(fixtureName));
  }

  receiveText(data: string): void {
    this.events.onMessage(data);
  }

  serverClose(code = 1006): void {
    this.events.onClose(code, "");
  }

  handshake(): void {
    this.events.onOpen();
    this.receive("stream-connected.json");
    this.receive("stream-authenticated.json");
  }
}

function setup(env: Record<string, string> = {}, deps: Partial<AlpacaDeps> = {}) {
  const sockets: FakeSocket[] = [];
  const statuses: ConnectionStatus[] = [];
  const ticks: Tick[] = [];
  const bars: Bar[] = [];
  const provider = createAlpacaProvider(
    { env: { ...ENV, ...env }, logger: pino({ level: "silent" }) },
    {
      openSocket: (url, events) => {
        const socket = new FakeSocket(url, events);
        sockets.push(socket);
        return socket;
      },
      random: () => 0.5,
      ...deps,
    },
  );
  const handlers = {
    onTick: (tick: Tick) => ticks.push(tick),
    onBar: (bar: Bar) => bars.push(bar),
    onStatus: (status: ConnectionStatus) => statuses.push(status),
  };
  const socketAt = (index: number): FakeSocket => {
    const socket = sockets[index];
    if (!socket) throw new Error(`socket ${index} was never opened`);
    return socket;
  };
  return { provider, handlers, sockets, socketAt, statuses, ticks, bars };
}

const subscribeMessage = (action: string, symbols: string[]) => ({
  action,
  trades: symbols,
  bars: symbols,
  updatedBars: symbols,
});

describe("Alpaca stream", () => {
  const T0 = Date.UTC(2026, 9, 14, 14, 0);

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("authenticates after the greeting, then subscribes the desired set and goes live", () => {
    const { provider, handlers, socketAt, statuses } = setup();
    provider.subscribe(["AAPL", "MSFT"]);
    provider.connect(handlers);

    const socket = socketAt(0);
    expect(socket.url).toBe("wss://stream.data.alpaca.markets/v2/iex");
    expect(statuses).toEqual([{ state: "connecting", reason: null, code: null, retryAt: null }]);
    expect(socket.sent).toEqual([]);

    socket.receive("stream-connected.json");
    expect(socket.sent).toEqual([{ action: "auth", key: "test-key-id", secret: "test-secret" }]);

    socket.receive("stream-authenticated.json");
    expect(socket.sent.at(-1)).toEqual(subscribeMessage("subscribe", ["AAPL", "MSFT"]));
    expect(statuses.at(-1)).toEqual({ state: "live", reason: null, code: null, retryAt: null });
  });

  it("sends only the change when subscriptions move while live", () => {
    const { provider, handlers, socketAt } = setup();
    provider.subscribe(["AAPL"]);
    provider.connect(handlers);
    const socket = socketAt(0);
    socket.handshake();

    provider.subscribe(["AAPL", "TSLA"]);
    provider.unsubscribe(["AAPL", "NVDA"]);
    expect(socket.sent.slice(-2)).toEqual([
      subscribeMessage("subscribe", ["TSLA"]),
      subscribeMessage("unsubscribe", ["AAPL"]),
    ]);
  });

  it("skips the subscribe message when nothing is desired", () => {
    const { provider, handlers, socketAt } = setup();
    provider.connect(handlers);
    socketAt(0).handshake();
    expect(socketAt(0).sent).toEqual([
      { action: "auth", key: "test-key-id", secret: "test-secret" },
    ]);
  });

  it("is idempotent on connect", () => {
    const { provider, handlers, sockets } = setup();
    provider.connect(handlers);
    provider.connect(handlers);
    expect(sockets).toHaveLength(1);
  });

  it("emits ticks and bars from batched frames, using the IEX source", () => {
    const { provider, handlers, socketAt, ticks, bars } = setup();
    provider.connect(handlers);
    const socket = socketAt(0);
    socket.handshake();

    socket.receive("stream-trades.json");
    socket.receive("stream-bar.json");
    socket.receive("stream-updated-bar.json");
    socket.receive("stream-mixed.json");

    expect(ticks.map((tick) => [tick.symbol, tick.ts])).toEqual([
      ["AAPL", Date.UTC(2021, 1, 22, 15, 51, 44, 208)],
      ["SPY", Date.UTC(2021, 1, 22, 15, 51, 45, 335)],
      ["AAPL", Date.UTC(2021, 1, 22, 15, 51, 49)],
    ]);
    expect(bars.map((bar) => [bar.source, bar.ts, bar.close])).toEqual([
      ["alpaca_iex", Date.UTC(2021, 1, 22, 19, 15), 389.12],
      ["alpaca_iex", Date.UTC(2021, 1, 22, 19, 15), 389.15],
    ]);
  });

  it("labels SIP live data when the SIP feed is configured", () => {
    const { provider } = setup({ ALPACA_STREAM_FEED: "sip" });
    expect(provider.liveSource).toBe("alpaca_sip");
    expect(provider.liveDataLabel).toBe("Live data: SIP");
  });

  it("reconnects with jittered backoff after a close and resubscribes the current set", () => {
    const { provider, handlers, sockets, socketAt, statuses } = setup();
    provider.subscribe(["AAPL"]);
    provider.connect(handlers);
    socketAt(0).handshake();

    socketAt(0).serverClose();
    // random 0.5 × min(60 s, 1 s × 2^0)
    expect(statuses.at(-1)).toEqual({
      state: "reconnecting",
      reason: expect.stringContaining("Reconnecting automatically"),
      code: null,
      retryAt: T0 + 500,
    });

    provider.subscribe(["MSFT"]);
    vi.advanceTimersByTime(499);
    expect(sockets).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(2);
    expect(statuses.at(-1)?.state).toBe("reconnecting");

    // A failed attempt before auth backs off further.
    socketAt(1).serverClose();
    expect(statuses.at(-1)?.retryAt).toBe(T0 + 500 + 1_000);
    vi.advanceTimersByTime(1_000);

    const socket = socketAt(2);
    socket.handshake();
    expect(socket.sent.at(-1)).toEqual(subscribeMessage("subscribe", ["AAPL", "MSFT"]));
    expect(statuses.at(-1)?.state).toBe("live");

    // Successful auth resets the backoff.
    socket.serverClose();
    expect(statuses.at(-1)?.retryAt).toBe(Date.now() + 500);
  });

  it("ignores late events from an abandoned socket", () => {
    const { provider, handlers, sockets, socketAt } = setup();
    provider.connect(handlers);
    socketAt(0).handshake();
    socketAt(0).serverClose();
    socketAt(0).serverClose();
    // One reconnect (500 ms), well before the new socket's own handshake timeout.
    vi.advanceTimersByTime(5_000);
    expect(sockets).toHaveLength(2);
  });

  it("retries when the handshake never completes", () => {
    const { provider, handlers, sockets, statuses } = setup();
    provider.connect(handlers);
    vi.advanceTimersByTime(15_000);
    expect(statuses.at(-1)?.state).toBe("reconnecting");
    expect(sockets[0]?.closed).toBe(true);
    vi.advanceTimersByTime(500);
    expect(sockets).toHaveLength(2);
  });

  it("stops for good when Alpaca rejects the keys (402)", () => {
    const { provider, handlers, sockets, socketAt, statuses } = setup();
    provider.connect(handlers);
    const socket = socketAt(0);
    socket.receive("stream-connected.json");
    socket.receive("stream-error-auth-failed.json");

    expect(statuses.at(-1)).toEqual({
      state: "error",
      reason: expect.stringContaining("ALPACA_KEY_ID / ALPACA_SECRET_KEY"),
      code: 402,
      retryAt: null,
    });
    expect(socket.closed).toBe(true);
    socket.serverClose();
    vi.advanceTimersByTime(10 * 60_000);
    expect(sockets).toHaveLength(1);
  });

  it("stops for good when the plan lacks the feed (409)", () => {
    const { provider, handlers, sockets, socketAt, statuses } = setup({
      ALPACA_STREAM_FEED: "sip",
    });
    provider.connect(handlers);
    socketAt(0).receive("stream-connected.json");
    socketAt(0).receiveText('[{"T":"error","code":409,"msg":"insufficient subscription"}]');
    expect(statuses.at(-1)).toMatchObject({ state: "error", code: 409 });
    expect(statuses.at(-1)?.reason).toContain("ALPACA_STREAM_FEED=iex");
    vi.advanceTimersByTime(10 * 60_000);
    expect(sockets).toHaveLength(1);
  });

  it("waits the full minute before retrying when another app holds the connection (406)", () => {
    const { provider, handlers, sockets, socketAt, statuses } = setup();
    provider.connect(handlers);
    const socket = socketAt(0);
    socket.receive("stream-connected.json");
    socket.receive("stream-error-connection-limit.json");

    expect(statuses.at(-1)).toEqual({
      state: "error",
      reason: expect.stringContaining("allows one connection"),
      code: 406,
      retryAt: T0 + 60_000,
    });
    vi.advanceTimersByTime(59_999);
    expect(sockets).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(2);
  });

  it("stays connected and reports the symbol limit (405)", () => {
    const { provider, handlers, socketAt, statuses } = setup();
    provider.connect(handlers);
    const socket = socketAt(0);
    socket.handshake();
    socket.receive("stream-error-symbol-limit.json");

    expect(statuses.at(-1)).toEqual({
      state: "live",
      reason: expect.stringContaining("30 live symbols"),
      code: 405,
      retryAt: null,
    });
    expect(socket.closed).toBe(false);
  });

  it("disconnect stops the stream and any pending reconnect", async () => {
    const { provider, handlers, sockets, socketAt, statuses } = setup();
    provider.connect(handlers);
    socketAt(0).handshake();
    socketAt(0).serverClose();

    await provider.disconnect();
    expect(statuses.at(-1)).toEqual({ state: "stopped", reason: null, code: null, retryAt: null });
    vi.advanceTimersByTime(10 * 60_000);
    expect(sockets).toHaveLength(1);

    provider.connect(handlers);
    expect(sockets).toHaveLength(2);
  });
});

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

function fixtureJson(name: string): unknown {
  return JSON.parse(fixture(name));
}

describe("Alpaca REST", () => {
  function restSetup(responses: Response[]) {
    const fetchMock = vi.fn<typeof fetch>();
    for (const response of responses) fetchMock.mockResolvedValueOnce(response);
    const sleeps: number[] = [];
    const { provider } = setup(
      {},
      {
        fetch: fetchMock,
        now: () => 1_000_000,
        sleep: async (ms) => {
          sleeps.push(ms);
        },
      },
    );
    const requests = () =>
      fetchMock.mock.calls.map(([input, init]) => ({
        url: new URL(String(input)),
        headers: new Headers(init?.headers),
      }));
    return { provider, requests, sleeps };
  }

  async function collect(pages: AsyncIterable<Bar[]>): Promise<Bar[][]> {
    const out: Bar[][] = [];
    for await (const page of pages) out.push(page);
    return out;
  }

  it("follows next_page_token and yields normalized SIP bars per page", async () => {
    const { provider, requests, sleeps } = restSetup([
      json(fixtureJson("rest-bars-page1.json")),
      json(fixtureJson("rest-bars-page2.json")),
    ]);
    const pages = await collect(
      provider.getBars(
        ["AAPL", "SPY"],
        new Date("2021-02-22T15:00:00Z"),
        new Date("2021-02-22T15:02:00Z"),
      ),
    );

    expect(pages.map((page) => page.map((bar) => [bar.symbol, bar.source, bar.ts]))).toEqual([
      [
        ["AAPL", "alpaca_sip", Date.UTC(2021, 1, 22, 15, 0)],
        ["AAPL", "alpaca_sip", Date.UTC(2021, 1, 22, 15, 1)],
      ],
      [
        ["SPY", "alpaca_sip", Date.UTC(2021, 1, 22, 15, 0)],
        ["SPY", "alpaca_sip", Date.UTC(2021, 1, 22, 15, 1)],
      ],
    ]);

    const [first, second] = requests();
    expect(first?.url.origin + (first?.url.pathname ?? "")).toBe(
      "https://data.alpaca.markets/v2/stocks/bars",
    );
    expect(Object.fromEntries(first?.url.searchParams ?? [])).toEqual({
      symbols: "AAPL,SPY",
      timeframe: "1Min",
      start: "2021-02-22T15:00:00.000Z",
      end: "2021-02-22T15:02:00.000Z",
      limit: "10000",
      feed: "sip",
      adjustment: "raw",
      sort: "asc",
    });
    expect(first?.headers.get("APCA-API-KEY-ID")).toBe("test-key-id");
    expect(first?.headers.get("APCA-API-SECRET-KEY")).toBe("test-secret");
    expect(second?.url.searchParams.get("page_token")).toBe(
      "QUFQTHxNfDIwMjEtMDItMjJUMTU6MDE6MDAuMDAwMDAwMDAwWg==",
    );
    // Back-to-back calls are spaced to stay under 200 requests/min.
    expect(sleeps).toEqual([350]);
  });

  it("treats the end of the range as exclusive", async () => {
    const { provider } = restSetup([json(fixtureJson("rest-bars-page2.json"))]);
    const pages = await collect(
      provider.getBars(["SPY"], new Date("2021-02-22T15:00:00Z"), new Date("2021-02-22T15:01:00Z")),
    );
    expect(pages.flat().map((bar) => bar.ts)).toEqual([Date.UTC(2021, 1, 22, 15, 0)]);
  });

  it("waits for the rate-limit reset after HTTP 429, then retries", async () => {
    const { provider, sleeps, requests } = restSetup([
      new Response("too many requests", {
        status: 429,
        headers: { "X-RateLimit-Reset": String(1_000_000 / 1000 + 7) },
      }),
      json(fixtureJson("rest-bars-page2.json")),
    ]);
    const pages = await collect(
      provider.getBars(["SPY"], new Date("2021-02-22T15:00:00Z"), new Date("2021-02-22T15:02:00Z")),
    );
    expect(pages.flat()).toHaveLength(2);
    expect(requests()).toHaveLength(2);
    expect(sleeps).toEqual([7_000, 350]);
  });

  it("throws with status and body snippet on other errors, never the keys", async () => {
    const { provider } = restSetup([
      new Response('{"message":"subscription does not permit querying recent SIP data"}', {
        status: 403,
      }),
    ]);
    const failure = collect(provider.getBars(["SPY"], new Date(0), new Date(60_000)));
    await expect(failure).rejects.toThrow(/HTTP 403 .*recent SIP data/);
    await expect(failure).rejects.not.toThrow(/test-secret|test-key-id/);
  });

  it("returns snapshots for the configured feed with previous close", async () => {
    const { provider, requests } = restSetup([json(fixtureJson("rest-snapshots.json"))]);
    const quotes = await provider.getSnapshots(["AAPL", "TSLA"]);
    expect(quotes).toEqual([
      expect.objectContaining({ symbol: "AAPL", lastPrice: 126, previousClose: 129.87 }),
      expect.objectContaining({ symbol: "TSLA", lastPrice: null, previousClose: 781.3 }),
    ]);
    expect(requests()[0]?.url.searchParams.get("feed")).toBe("iex");
  });

  it("reads the NYSE phase from the v3 clock", async () => {
    const { provider, requests } = restSetup([json(fixtureJson("rest-clock-v3.json"))]);
    await expect(provider.getClock()).resolves.toMatchObject({
      phase: "pre",
      phaseUntil: Date.UTC(2025, 5, 24, 13, 30),
    });
    expect(requests()[0]?.url.href).toBe("https://paper-api.alpaca.markets/v3/clock?markets=NYSE");
  });

  it("looks up assets and returns null for unknown symbols", async () => {
    const { provider, requests } = restSetup([
      json(fixtureJson("rest-asset-aapl.json")),
      new Response('{"code":40410000,"message":"asset not found for ZZZZ"}', { status: 404 }),
    ]);
    await expect(provider.getAsset("AAPL")).resolves.toEqual({
      symbol: "AAPL",
      name: "Apple Inc. Common Stock",
      exchange: "NASDAQ",
    });
    await expect(provider.getAsset("ZZZZ")).resolves.toBeNull();
    expect(requests().map((request) => request.url.href)).toEqual([
      "https://paper-api.alpaca.markets/v2/assets/AAPL",
      "https://paper-api.alpaca.markets/v2/assets/ZZZZ",
    ]);
  });

  it("fetches split-adjusted daily SIP bars as New York trading dates, end exclusive", async () => {
    const { provider, requests } = restSetup([
      json({
        bars: {
          AAPL: [{ t: "2026-10-12T04:00:00Z", o: 1, h: 2, l: 0.5, c: 1.5, v: 100, n: 10, vw: 1.2 }],
        },
        next_page_token: null,
      }),
    ]);
    const pages = [];
    for await (const page of provider.getDailyBars(["AAPL"], "2026-10-01", "2026-10-13"))
      pages.push(page);
    expect(pages.flat()).toEqual([
      {
        symbol: "AAPL",
        source: "alpaca_sip",
        day: "2026-10-12",
        open: 1,
        high: 2,
        low: 0.5,
        close: 1.5,
        volume: 100,
      },
    ]);
    const url = requests()[0]?.url;
    expect(url?.searchParams.get("timeframe")).toBe("1Day");
    expect(url?.searchParams.get("adjustment")).toBe("split");
    expect(url?.searchParams.get("feed")).toBe("sip");
    // Alpaca's date `end` is inclusive: asking for the excluded day would reach into a session
    // that may still be running, which the free plan rejects with 403.
    expect(url?.searchParams.get("end")).toBe("2026-10-12");
  });

  it("lists streamable equities, skipping ineligible and malformed entries", async () => {
    const aapl = AssetResponseSchema.parse(fixtureJson("rest-asset-aapl.json"));
    const { provider, requests } = restSetup([
      json([
        aapl,
        { ...aapl, symbol: "OTCX", exchange: "OTC" },
        { ...aapl, symbol: "DEAD", status: "inactive" },
        { symbol: "BROKEN" },
      ]),
    ]);
    await expect(provider.listAssets()).resolves.toEqual([
      { symbol: "AAPL", name: "Apple Inc. Common Stock", exchange: "NASDAQ" },
    ]);
    expect(requests()[0]?.url.href).toBe(
      "https://paper-api.alpaca.markets/v2/assets?status=active&asset_class=us_equity",
    );
  });

  it("reads recent headlines newest first, linking only articles with a public page", async () => {
    const { provider, requests } = restSetup([json(fixtureJson("rest-news.json"))]);
    await expect(provider.getNews("AAPL", new Date("2026-09-14T00:00:00Z"), 20)).resolves.toEqual([
      {
        id: "62345574",
        headline: "Apple Shares Rise After Supplier Raises Guidance",
        summary: "A key supplier lifted its quarterly outlook.",
        source: "benzinga",
        url: "https://www.benzinga.com/news/26/10/62345574/apple-shares-rise",
        createdAt: "2026-10-14T07:36:15.000Z",
      },
      {
        id: "62340001",
        headline: "Options Activity In Apple",
        summary: "",
        source: "benzinga",
        url: null,
        createdAt: "2026-10-13T20:05:00.000Z",
      },
    ]);
    const [request] = requests();
    expect(request?.url.origin + (request?.url.pathname ?? "")).toBe(
      "https://data.alpaca.markets/v1beta1/news",
    );
    expect(Object.fromEntries(request?.url.searchParams ?? [])).toEqual({
      symbols: "AAPL",
      start: "2026-09-14T00:00:00.000Z",
      limit: "20",
      sort: "desc",
      include_content: "false",
    });
    expect(request?.headers.get("APCA-API-KEY-ID")).toBe("test-key-id");
  });
});
