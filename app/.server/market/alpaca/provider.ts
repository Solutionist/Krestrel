// Alpaca Market Data v2 provider (free Basic plan). Limits and message semantics:
// ai/market-data.md. One stream connection only: a second one gets error 406.
import * as z from "zod";

import type { DividendPayment } from "~/lib/dividends";
import type {
  Asset,
  BarSource,
  ConnectionStatus,
  MarketClock,
  NewsItem,
  QuoteSnapshot,
} from "~/lib/market";

import { backoffDelay } from "../backoff";
import type { MarketDataProvider, ProviderContext, ProviderHandlers } from "../provider";
import { parseAlpacaConfig } from "./config";
import {
  assetToAsset,
  clockToMarketClock,
  newsToNewsItem,
  snapshotToQuote,
  toBar,
  toDailyBar,
  tradeToTick,
} from "./normalize";
import {
  AssetListResponseSchema,
  AssetResponseSchema,
  BarsPageSchema,
  ClockResponseSchema,
  CorporateActionsResponseSchema,
  NewsResponseSchema,
  parseStreamFrame,
  SnapshotsResponseSchema,
  type StreamMessage,
} from "./schemas";

export interface AlpacaSocketEvents {
  onOpen(): void;
  onMessage(data: string): void;
  onClose(code: number, reason: string): void;
  onError(error: unknown): void;
}

export interface AlpacaSocket {
  send(data: string): void;
  close(): void;
}

export interface AlpacaDeps {
  /** Opens the stream socket; defaults to Node's global `WebSocket`. */
  openSocket(url: string, events: AlpacaSocketEvents): AlpacaSocket;
  fetch: typeof fetch;
  now(): number;
  random(): number;
  sleep(ms: number): Promise<void>;
}

const MAX_SYMBOLS = 30;
const HISTORY_SOURCE: BarSource = "alpaca_sip";
const HISTORY_DELAY_MS = 15 * 60_000;
const RECONNECT_CAP_MS = 60_000;
/** Alpaca drops sockets that don't authenticate within 10 s; give the whole handshake 15 s. */
const HANDSHAKE_TIMEOUT_MS = 15_000;
/** 200 requests/min on the free plan → one call every 300 ms; 350 ms leaves headroom. */
const REST_MIN_SPACING_MS = 350;
const RATE_LIMIT_FALLBACK_WAIT_MS = 60_000;
const MAX_RATE_LIMIT_RETRIES = 3;

const REASON_RECONNECTING = "Reconnecting to Alpaca…";
const REASON_CONNECTION_LOST = "Lost the connection to Alpaca. Reconnecting automatically.";
const REASON_KEYS_REJECTED =
  "Alpaca rejected the API keys. Check ALPACA_KEY_ID / ALPACA_SECRET_KEY in .env and restart.";
const REASON_CONNECTION_LIMIT =
  "Another app is already using your Alpaca stream (the free plan allows one connection). Close it; retrying every minute.";
const REASON_SYMBOL_LIMIT = `Alpaca allows ${MAX_SYMBOLS} live symbols on this plan; some symbols weren't added. Remove symbols from the watchlist.`;

type StreamPhase =
  | "idle"
  | "connecting"
  | "authenticating"
  | "live"
  | "waiting"
  | "halted"
  | "stopped";

function openNodeSocket(url: string, events: AlpacaSocketEvents): AlpacaSocket {
  const socket = new WebSocket(url);
  socket.binaryType = "arraybuffer";
  socket.addEventListener("open", () => events.onOpen());
  socket.addEventListener("message", (event) => {
    if (typeof event.data === "string") events.onMessage(event.data);
    else if (event.data instanceof ArrayBuffer) {
      events.onMessage(new TextDecoder().decode(event.data));
    }
  });
  socket.addEventListener("close", (event) => events.onClose(event.code, event.reason));
  socket.addEventListener("error", (event) => events.onError(event));
  return { send: (data) => socket.send(data), close: () => socket.close() };
}

function sleep(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

export function createAlpacaProvider(
  context: ProviderContext,
  deps: Partial<AlpacaDeps> = {},
): MarketDataProvider {
  const config = parseAlpacaConfig(context.env);
  const log = context.logger.child({ mod: "alpaca" });
  const io: AlpacaDeps = {
    openSocket: deps.openSocket ?? openNodeSocket,
    fetch: deps.fetch ?? ((input, init) => fetch(input, init)),
    now: deps.now ?? (() => Date.now()),
    random: deps.random ?? Math.random,
    sleep: deps.sleep ?? sleep,
  };
  const liveSource: BarSource = config.feed === "iex" ? "alpaca_iex" : "alpaca_sip";

  // ---- Stream ----

  const desired = new Set<string>();
  let handlers: ProviderHandlers | null = null;
  let phase: StreamPhase = "idle";
  let socket: AlpacaSocket | null = null;
  /** Bumped whenever a socket is abandoned so its late events are ignored. */
  let generation = 0;
  let attempt = 0;
  let retrying = false;
  let reconnectTimer: NodeJS.Timeout | undefined;
  let handshakeTimer: NodeJS.Timeout | undefined;

  function emit(status: ConnectionStatus): void {
    handlers?.onStatus(status);
  }

  function dropSocket(): void {
    generation += 1;
    clearTimeout(handshakeTimer);
    const closing = socket;
    socket = null;
    try {
      closing?.close();
    } catch (err) {
      log.debug({ err }, "closing alpaca socket failed");
    }
  }

  function scheduleReconnect(
    status: { state: "reconnecting" | "error"; reason: string; code: number | null },
    delayMs: number,
  ): void {
    dropSocket();
    phase = "waiting";
    retrying = true;
    emit({ ...status, retryAt: io.now() + delayMs });
    reconnectTimer = setTimeout(() => {
      openStream();
    }, delayMs);
  }

  function retryWithBackoff(code: number | null): void {
    const delayMs = backoffDelay(attempt, { capMs: RECONNECT_CAP_MS, random: io.random });
    attempt += 1;
    log.warn({ code, attempt, delayMs }, "alpaca stream down; reconnecting");
    scheduleReconnect({ state: "reconnecting", reason: REASON_CONNECTION_LOST, code }, delayMs);
  }

  function halt(code: number, reason: string): void {
    dropSocket();
    phase = "halted";
    emit({ state: "error", reason, code, retryAt: null });
  }

  function sendChannels(action: "subscribe" | "unsubscribe", symbols: readonly string[]): void {
    if (symbols.length === 0) return;
    socket?.send(JSON.stringify({ action, trades: symbols, bars: symbols, updatedBars: symbols }));
  }

  function openStream(): void {
    phase = "connecting";
    emit(
      retrying
        ? { state: "reconnecting", reason: REASON_RECONNECTING, code: null, retryAt: null }
        : { state: "connecting", reason: null, code: null, retryAt: null },
    );
    generation += 1;
    const own = generation;
    try {
      socket = io.openSocket(config.streamUrl, {
        onOpen: () => {
          if (own === generation) log.debug("alpaca socket open; waiting for greeting");
        },
        onMessage: (data) => {
          if (own === generation) handleFrame(data, own);
        },
        onClose: (code, reason) => {
          if (own !== generation) return;
          log.warn({ closeCode: code, closeReason: reason }, "alpaca stream closed");
          retryWithBackoff(null);
        },
        onError: (err) => {
          if (own !== generation) return;
          log.warn({ err }, "alpaca stream socket error");
          retryWithBackoff(null);
        },
      });
    } catch (err) {
      log.warn({ err }, "opening alpaca stream failed");
      retryWithBackoff(null);
      return;
    }
    handshakeTimer = setTimeout(() => {
      log.warn("alpaca stream handshake timed out");
      retryWithBackoff(null);
    }, HANDSHAKE_TIMEOUT_MS);
  }

  function handleFrame(data: string, own: number): void {
    for (const message of parseStreamFrame(data, log)) {
      // A message (e.g. an error) may have abandoned this socket; drop the rest of the batch.
      if (own !== generation) return;
      handleMessage(message);
    }
  }

  function handleMessage(message: StreamMessage): void {
    switch (message.T) {
      case "t":
        handlers?.onTick(tradeToTick(message));
        return;
      case "b":
      case "u":
        handlers?.onBar(toBar(message.S, message, liveSource));
        return;
      case "c":
        log.info({ symbol: message.S }, "alpaca trade correction received; not applied");
        return;
      case "x":
        log.info({ symbol: message.S, kind: message.a }, "alpaca trade cancel/error; not applied");
        return;
      case "success":
        if (message.msg === "connected" && phase === "connecting") {
          phase = "authenticating";
          // Never log this message: it carries the secret.
          socket?.send(
            JSON.stringify({ action: "auth", key: config.keyId, secret: config.secretKey }),
          );
        } else if (message.msg === "authenticated" && phase === "authenticating") {
          clearTimeout(handshakeTimer);
          phase = "live";
          attempt = 0;
          retrying = false;
          sendChannels("subscribe", [...desired]);
          log.info({ feed: config.feed, symbols: desired.size }, "alpaca stream live");
          emit({ state: "live", reason: null, code: null, retryAt: null });
        } else {
          log.debug({ upstreamMsg: message.msg, phase }, "alpaca success message ignored");
        }
        return;
      case "subscription":
        log.info(
          { trades: message.trades?.length ?? 0, bars: message.bars?.length ?? 0 },
          "alpaca subscription confirmed",
        );
        return;
      case "error":
        handleUpstreamError(message.code, message.msg);
        return;
    }
  }

  function handleUpstreamError(code: number, upstreamMsg: string): void {
    switch (code) {
      case 402:
        log.error({ code, upstreamMsg }, "alpaca rejected the API keys");
        halt(code, REASON_KEYS_REJECTED);
        return;
      case 409:
        log.error({ code, upstreamMsg, feed: config.feed }, "alpaca plan lacks the stream feed");
        halt(
          code,
          `Your Alpaca plan doesn't include the ${config.feed.toUpperCase()} feed. Set ALPACA_STREAM_FEED=iex in .env and restart.`,
        );
        return;
      case 406:
        log.error({ code, upstreamMsg }, "alpaca stream connection limit reached");
        // Retrying fast would keep fighting the other app for the single slot.
        scheduleReconnect(
          { state: "error", reason: REASON_CONNECTION_LIMIT, code },
          RECONNECT_CAP_MS,
        );
        return;
      case 405:
        // Alpaca keeps the connection and the existing subscriptions.
        log.error({ code, upstreamMsg, symbols: desired.size }, "alpaca symbol limit exceeded");
        emit({ state: "live", reason: REASON_SYMBOL_LIMIT, code, retryAt: null });
        return;
      case 404:
      case 407:
      case 500:
        log.warn({ code, upstreamMsg }, "alpaca stream error; reconnecting");
        retryWithBackoff(code);
        return;
      default:
        log.error({ code, upstreamMsg }, "alpaca stream error");
    }
  }

  // ---- REST ----

  const authHeaders = {
    "APCA-API-KEY-ID": config.keyId,
    "APCA-API-SECRET-KEY": config.secretKey,
  };
  let lastRequestAt = Number.NEGATIVE_INFINITY;
  let queue: Promise<void> = Promise.resolve();

  /** Serializes REST calls at least REST_MIN_SPACING_MS apart (free plan: 200/min). */
  function takeTurn(): Promise<void> {
    const turn = queue.then(async () => {
      const waitMs = lastRequestAt + REST_MIN_SPACING_MS - io.now();
      if (waitMs > 0) await io.sleep(waitMs);
      lastRequestAt = io.now();
    });
    queue = turn;
    return turn;
  }

  async function send(url: URL): Promise<Response> {
    for (let retries = 0; ; retries += 1) {
      await takeTurn();
      const response = await io.fetch(url, { headers: authHeaders });
      if (response.status !== 429 || retries >= MAX_RATE_LIMIT_RETRIES) return response;
      // X-RateLimit-Reset is the UNIX epoch second when the window resets.
      const untilReset = Number(response.headers.get("X-RateLimit-Reset")) * 1000 - io.now();
      const waitMs =
        Number.isFinite(untilReset) && untilReset > 0
          ? Math.min(untilReset, RATE_LIMIT_FALLBACK_WAIT_MS)
          : RATE_LIMIT_FALLBACK_WAIT_MS;
      log.warn({ path: url.pathname, waitMs }, "alpaca rate limit hit; waiting");
      await response.body?.cancel();
      await io.sleep(waitMs);
    }
  }

  async function readBody<T extends z.ZodType>(
    response: Response,
    schema: T,
    what: string,
  ): Promise<z.output<T>> {
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      const snippet = text.replace(/\s+/g, " ").trim().slice(0, 200);
      throw new Error(`Alpaca ${what} request failed: HTTP ${response.status} ${snippet}`.trim());
    }
    const parsed = schema.safeParse(await response.json());
    if (!parsed.success) {
      throw new Error(
        `Alpaca ${what} response had an unexpected shape:\n${z.prettifyError(parsed.error)}`,
      );
    }
    return parsed.data;
  }

  return {
    id: "alpaca",
    displayName: "Alpaca",
    liveDataLabel:
      config.feed === "iex" ? "Live data: IEX only (partial volume)" : "Live data: SIP",
    maxSymbols: MAX_SYMBOLS,
    liveSource,
    historySource: HISTORY_SOURCE,
    historyDelayMs: HISTORY_DELAY_MS,
    maxSymbolsPerHistoryRequest: MAX_SYMBOLS,

    connect(next: ProviderHandlers): void {
      if (phase !== "idle" && phase !== "stopped") return;
      handlers = next;
      attempt = 0;
      retrying = false;
      openStream();
    },

    async disconnect(): Promise<void> {
      clearTimeout(reconnectTimer);
      dropSocket();
      const wasRunning = phase !== "idle" && phase !== "stopped";
      phase = "stopped";
      if (wasRunning) emit({ state: "stopped", reason: null, code: null, retryAt: null });
    },

    subscribe(symbols: readonly string[]): void {
      const added = [...new Set(symbols)].filter((symbol) => !desired.has(symbol));
      for (const symbol of added) desired.add(symbol);
      if (phase === "live") sendChannels("subscribe", added);
    },

    unsubscribe(symbols: readonly string[]): void {
      const removed = [...new Set(symbols)].filter((symbol) => desired.has(symbol));
      for (const symbol of removed) desired.delete(symbol);
      if (phase === "live") sendChannels("unsubscribe", removed);
    },

    async *getBars(symbols, start, end) {
      const endMs = end.getTime();
      for (let offset = 0; offset < symbols.length; offset += MAX_SYMBOLS) {
        const batch = symbols.slice(offset, offset + MAX_SYMBOLS);
        let pageToken: string | null = null;
        do {
          const url = new URL(`${config.dataUrl}/v2/stocks/bars`);
          url.search = new URLSearchParams({
            symbols: batch.join(","),
            timeframe: "1Min",
            start: start.toISOString(),
            end: end.toISOString(),
            limit: "10000",
            feed: "sip",
            adjustment: "raw",
            sort: "asc",
            ...(pageToken ? { page_token: pageToken } : {}),
          }).toString();
          const page = await readBody(await send(url), BarsPageSchema, "bars");
          // Alpaca's `end` is inclusive; the contract is [start, end).
          const bars = Object.entries(page.bars ?? {})
            .flatMap(([symbol, rows]) => rows.map((row) => toBar(symbol, row, HISTORY_SOURCE)))
            .filter((bar) => bar.ts < endMs);
          if (bars.length > 0) yield bars;
          pageToken = page.next_page_token ?? null;
        } while (pageToken);
      }
    },

    async *getDailyBars(symbols, startDay, endDay) {
      // Alpaca's date `end` is inclusive and covers that whole day. Sending `endDay` itself would
      // reach into today's session, which the free plan rejects (403 "recent SIP data").
      const lastDay = new Date(Date.parse(`${endDay}T00:00:00Z`) - 86_400_000)
        .toISOString()
        .slice(0, 10);
      for (let offset = 0; offset < symbols.length; offset += MAX_SYMBOLS) {
        const batch = symbols.slice(offset, offset + MAX_SYMBOLS);
        let pageToken: string | null = null;
        do {
          const url = new URL(`${config.dataUrl}/v2/stocks/bars`);
          url.search = new URLSearchParams({
            symbols: batch.join(","),
            timeframe: "1Day",
            start: startDay,
            end: lastDay,
            limit: "10000",
            feed: "sip",
            // Split-adjusted so long-range charts don't show split cliffs.
            adjustment: "split",
            sort: "asc",
            ...(pageToken ? { page_token: pageToken } : {}),
          }).toString();
          const page = await readBody(await send(url), BarsPageSchema, "daily bars");
          const bars = Object.entries(page.bars ?? {}).flatMap(([symbol, rows]) =>
            rows.map((row) => toDailyBar(symbol, row, HISTORY_SOURCE)),
          );
          if (bars.length > 0) yield bars;
          pageToken = page.next_page_token ?? null;
        } while (pageToken);
      }
    },

    async getSnapshots(symbols: readonly string[]): Promise<QuoteSnapshot[]> {
      if (symbols.length === 0) return [];
      const url = new URL(`${config.dataUrl}/v2/stocks/snapshots`);
      url.searchParams.set("symbols", symbols.join(","));
      url.searchParams.set("feed", config.feed);
      const body = await readBody(await send(url), SnapshotsResponseSchema, "snapshots");
      return Object.entries(body).flatMap(([symbol, snapshot]) =>
        snapshot ? [snapshotToQuote(symbol, snapshot)] : [],
      );
    },

    async getClock(): Promise<MarketClock> {
      const url = new URL(`${config.tradingUrl}/v3/clock`);
      url.searchParams.set("markets", "NYSE");
      const body = await readBody(await send(url), ClockResponseSchema, "clock");
      const clock = body.clocks[0];
      if (!clock) throw new Error("Alpaca clock response listed no markets");
      if (clock.phase === "lunch")
        log.warn("alpaca reported a lunch phase for NYSE; treating as open");
      return clockToMarketClock(clock);
    },

    async getAsset(symbol: string): Promise<Asset | null> {
      const url = new URL(`${config.tradingUrl}/v2/assets/${encodeURIComponent(symbol)}`);
      const response = await send(url);
      if (response.status === 404) {
        await response.body?.cancel();
        return null;
      }
      return assetToAsset(await readBody(response, AssetResponseSchema, "asset"));
    },

    async listAssets(): Promise<Asset[]> {
      const url = new URL(`${config.tradingUrl}/v2/assets`);
      url.search = new URLSearchParams({ status: "active", asset_class: "us_equity" }).toString();
      const items = await readBody(await send(url), AssetListResponseSchema, "asset list");
      const assets: Asset[] = [];
      let skipped = 0;
      for (const item of items) {
        const parsed = AssetResponseSchema.safeParse(item);
        const asset = parsed.success ? assetToAsset(parsed.data) : null;
        if (asset) assets.push(asset);
        else if (!parsed.success) skipped++;
      }
      if (skipped > 0) log.warn({ skipped }, "ignored malformed entries in alpaca asset list");
      return assets;
    },

    async getNews(symbol: string, since: Date, limit: number): Promise<NewsItem[]> {
      const url = new URL(`${config.dataUrl}/v1beta1/news`);
      url.search = new URLSearchParams({
        symbols: symbol,
        start: since.toISOString(),
        limit: String(limit),
        sort: "desc",
        include_content: "false",
      }).toString();
      const body = await readBody(await send(url), NewsResponseSchema, "news");
      return body.news.map(newsToNewsItem);
    },

    async getDividends(symbols, startDay, endDay) {
      const payments: Array<DividendPayment & { symbol: string }> = [];
      // Comma lists in the query string; 100 symbols keeps URLs short.
      for (let index = 0; index < symbols.length; index += 100) {
        let pageToken: string | null = null;
        do {
          const url = new URL(`${config.dataUrl}/v1/corporate-actions`);
          url.search = new URLSearchParams({
            symbols: symbols.slice(index, index + 100).join(","),
            types: "cash_dividend",
            start: startDay,
            end: endDay,
            limit: "1000",
            sort: "asc",
            ...(pageToken ? { page_token: pageToken } : {}),
          }).toString();
          const body = await readBody(
            await send(url),
            CorporateActionsResponseSchema,
            "corporate actions",
          );
          for (const dividend of body.corporate_actions.cash_dividends ?? []) {
            payments.push({
              symbol: dividend.symbol,
              exDate: dividend.ex_date,
              payDate: dividend.payable_date ?? null,
              amount: dividend.rate,
              special: dividend.special ?? false,
            });
          }
          pageToken = body.next_page_token ?? null;
        } while (pageToken);
      }
      return payments.sort((a, b) => a.exDate.localeCompare(b.exDate));
    },
  };
}
