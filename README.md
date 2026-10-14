# Krestrel

A featherweight, self-hosted real-time ticker for NYSE & Nasdaq. Live prices, candlestick charts, and alerts, running on your own machine.

> Personal use only. Market data from Alpaca is licensed for personal, non-professional use. Krestrel binds to `127.0.0.1` and is not meant to be hosted publicly or shared.

## Features

- **Watchlist** with a search dropdown (type `a` to see tickers starting with A, or part of a company name), up to 30 symbols (the Alpaca free plan's streaming limit), validated against active NYSE/Nasdaq listings, persisted in Postgres.
- **Clean light and dark navy themes** (follows your system, switch in the top bar), Geist type.
- **Live prices** with change vs. previous close (▲/▼ plus colour), a brief flash on update, and a connection indicator.
- **Candlestick charts** (TradingView Lightweight Charts) with TradingView-style intervals: 1m, 5m, 15m, 30m, 1h, 4h, 1D, 1W, 2W, 1M, 1Y, axis labels in New York time. Each interval opens on a sensible period (1m shows a day, 1D a year, 1W five years); scroll to zoom, drag to pan; **Select range** (or Shift+drag) lets you drag from a start point to an end point to see that period's change, bars and high/low, then zooms into it, and ↶ goes back to the previous view.
- **Hindsight analysis**: Buy/Sell markers at the most profitable past swing-low→swing-high round trips, support/resistance lines (S1…/R1…) and a rising trend-support line, computed locally.
- **AI analysis**: Claude (pick Haiku, Sonnet, Opus or Fable) ranks and explains those points using your own Claude Code CLI and Claude subscription (opt-in per click; sends that chart's candles to Anthropic). Hindsight, not financial advice.
- **Indicators**: EMA 20/50/100, Bollinger Bands (20, 2) and RSI 14 (own pane), toggled per chart and remembered. Up to 10 years of daily history for the long intervals. History loads first, then the live candle updates in real time.
- **Watchlist sorting**: my order, symbol, price, change % or change, ascending or descending, remembered.
- **RSI signals**: overbought/oversold zones and Buy/Sell markers in the RSI pane, plus a daily RSI signal (Oversold, Buy, Sell, Overbought) for every watchlist stock and holding, using one set of levels you choose (default 70/30). A momentum rule of thumb, not advice.
- **Portfolios**: named portfolios of buy/sell trades (fractional shares, fees), live value, unrealized/realized/today's P/L with the average-cost method, and an all-portfolios total. Sells of more shares than you held are refused.
- **Display currency**: view portfolio amounts (and a converted chart price) in THB or ~30 other currencies at the European Central Bank's daily rate (via frankfurter.dev; only currency codes are sent).
- **Minute-bar recording**: live 1-minute bars are stored, and full-market history is backfilled automatically.
- **Market status**: open, closed, pre-market, after hours.
- **Pluggable data providers**: Alpaca today, a simulated `mock` provider for offline use; other APIs (e.g. Finnhub) plug in without touching the rest of the app.
- **Price alerts**: planned (Phase 4).

Live data on the free plan comes from the IEX exchange only (partial volume); the UI says so. Complete-market history is available once it is at least 15 minutes old.

## Requirements

- Node.js 24 LTS (`.nvmrc`)
- [Bun](https://bun.sh) 1.4 (package manager and script runner only; the app runs on Node)
- Docker (for PostgreSQL 18)
- An [Alpaca](https://alpaca.markets) account (free; paper-trading keys work for market data), or use the mock provider

## Quick start

```bash
bun install
cp .env.example .env          # then fill in ALPACA_KEY_ID and ALPACA_SECRET_KEY
bun run db:up                 # Postgres on 127.0.0.1:5432
bun run dev                   # http://127.0.0.1:5173
```

Migrations run automatically when the server starts. Add a symbol in the sidebar to start streaming.

**No Alpaca keys?** Set `MARKET_PROVIDER=mock` in `.env` for simulated, deterministic market data.

### Full stack in Docker

```bash
cp .env.example .env          # fill in keys or set MARKET_PROVIDER=mock
docker compose up -d --build --wait
```

Open http://127.0.0.1:3000. Ports are published on `127.0.0.1` only.

## Configuration (`.env`)

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | `postgres://krestrel:krestrel@127.0.0.1:5432/krestrel` | Postgres for host runs (compose overrides it for the container) |
| `MARKET_PROVIDER` | `alpaca` | `alpaca` or `mock` |
| `BACKFILL_DAYS` | `30` | Days of 1-minute history per symbol (intraday intervals) |
| `DAILY_HISTORY_YEARS` | `10` | Years of daily history per symbol (1D–1Y intervals) |
| `LOG_LEVEL` | `info` | `trace` … `fatal` |
| `ALPACA_KEY_ID`, `ALPACA_SECRET_KEY` | — | Required for `alpaca` |
| `ALPACA_STREAM_FEED` | `iex` | `iex` (free) or `sip` (paid) |
| `ALPACA_TRADING_URL` | `https://paper-api.alpaca.markets` | Clock and asset lookup. Use `https://api.alpaca.markets` with live-account keys. A trailing `/v2` (as shown in Alpaca's dashboard) is fine |
| `LLM_PROVIDER` | `claude-cli` | `claude-cli` (your Claude Code CLI + subscription) or `none` |
| `CLAUDE_CLI_PATH`, `CLAUDE_MODEL`, `CLAUDE_TIMEOUT_MS` | `claude`, CLI default, `180000` | Where the CLI is, the default model (the panel's model picker overrides it), how long to wait |
| `MOCK_SEED`, `MOCK_TICK_MS` | `42`, `1000` | Mock provider seed and tick interval |
| `POSTGRES_*`, `APP_PORT` | see `.env.example` | Docker Compose settings |

Invalid or missing settings stop the server at startup with a message naming each variable.

## Commands

| Command | What it does |
|---|---|
| `bun run dev` | Dev server (127.0.0.1:5173) |
| `bun run build` / `bun run start` | Production build / serve |
| `bun run typecheck` · `bun run lint` · `bun run format` | Types, Biome lint, Biome format |
| `bun run test` | Unit, component, and DB tests (needs `bun run db:up`). Use `bun run test`, not `bun test` |
| `bun run db:up` / `bun run db:down` | Start / stop Postgres |
| `bun run db:generate` / `db:migrate` / `db:studio` | Drizzle migrations and studio |

## Troubleshooting

| Symptom | Fix |
|---|---|
| "Invalid environment configuration" at startup | Fix the variables listed in the message; compare with `.env.example` |
| "Alpaca rejected the API keys" | Check `ALPACA_KEY_ID` / `ALPACA_SECRET_KEY`; paper keys need the paper `ALPACA_TRADING_URL`, live keys the live one |
| "Another app is already using your Alpaca stream" (406) | The free plan allows one stream connection. Close other apps or a second Krestrel (e.g. `dev` and Docker together); it retries every minute |
| Market status "unknown" or symbols can't be added | Trading API unreachable or wrong `ALPACA_TRADING_URL` for your keys |
| "Port 5173 is already in use" | Another dev server is running; Krestrel refuses to start a second one so it never opens a second upstream connection |
| "server startup failed (is Postgres running?)" | `bun run db:up` |
| "Claude Code isn't signed in" | Run `claude` in a terminal and `/login` with your Claude account |
| "Claude Code isn't installed here" | Install Claude Code, or set `CLAUDE_CLI_PATH`. Not available inside the Docker image |
| Code change to the market hub not picked up | Restart `bun run dev` (the hub survives hot reload on purpose) |

## Project docs

`CLAUDE.md` is the entry point for contributors and AI agents; detailed guidelines and decision records live in [`ai/`](ai/README.md).
