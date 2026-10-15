<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="public/brand/krestrel-logo-on-dark.svg">
  <img src="public/brand/krestrel-logo-on-light.svg" alt="Krestrel — local trading platform" width="420">
</picture>

**A self-hosted, real-time ticker for NYSE & Nasdaq.**<br>
Live prices, candlestick charts, portfolios and AI insight, all running on your own machine.

![Node 24](https://img.shields.io/badge/node-24_LTS-339933?logo=node.js&logoColor=white)
![React Router 8](https://img.shields.io/badge/React_Router-8-CA4245?logo=reactrouter&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)
![PostgreSQL 18](https://img.shields.io/badge/PostgreSQL-18-4169E1?logo=postgresql&logoColor=white)
![Local only](https://img.shields.io/badge/binds_to-127.0.0.1-10b981)

</div>

> [!IMPORTANT]
> **Personal use only.** Alpaca market data is licensed for personal, non-professional use. Krestrel binds to `127.0.0.1` and is not meant to be hosted publicly or shared. It never places orders.

---

## Contents

- [Features](#features)
- [Quick start](#quick-start)
- [Optional extras](#optional-extras)
- [Configuration](#configuration)
- [Commands](#commands)
- [Troubleshooting](#troubleshooting)
- [Project docs](#project-docs)

## Features

### 📈 Markets

- **Watchlist**: up to 30 symbols (the Alpaca free-plan streaming limit), with search by ticker or company name. Every symbol is checked against active NYSE/Nasdaq listings. Sort by your own order, symbol, price or change.
- **Live prices**: change vs. previous close (▲/▼ plus colour), a flash on each update, and a connection indicator.
- **Candlestick charts**: intervals 1m · 5m · 15m · 30m · 1h · 4h · 1D · 1W · 2W · 1M · 1Y, with up to 10 years of daily history. Zoom, pan, and **Select range** (Shift+drag) to measure any period.
- **Indicators**: EMA 20/50/100, Bollinger Bands (20, 2), and RSI 14 with overbought/oversold zones and Buy/Sell markers.
- **Hindsight analysis**: best past swing trades, support/resistance levels, a trend line, and a rule-based plan (buy zone, stop, targets), all computed locally.
- **Market status**: open, closed, pre-market or after hours.

### 💼 Portfolio

- **Named portfolios** of buys and sells: fractional shares, fees, live value, and unrealized/realized/today's P/L (average-cost method). Sells of more shares than you held are refused.
- **Sortable holdings**: click any column header (▲/▼).
- **Import from a screenshot**: paste (Ctrl+V) a broker screen such as Dime. A local open vision model reads ticker, shares and average cost; you review and edit, then import. The image never leaves your machine.
- **Average-down calculator**: e.g. 50 @ $150, buy at $80, target $120 → 37.5 shares ($3,000).
- **Display currency**: THB and ~30 others at the European Central Bank's daily rate (only currency codes are sent).

### 🤖 AI (opt-in, per click)

- **AI outlook**: Claude reads recent news, the analyst consensus and price targets, then suggests buy, exit and take-profit levels with sources.
- **Stock ideas**: 5–10 growth, dividend and risky picks steered by your portfolio's sector mix. Only tickers and percentage weights are sent.
- **RSI signals**: a daily Oversold / Buy / Sell / Overbought signal for every watchlist stock and holding.

Both AI features use **your own** Claude Code CLI and subscription. None of it is financial advice.

### ⚙️ Under the hood

- Light and dark navy themes (follows your system), Geist type.
- Live 1-minute bars are recorded, and full-market history is backfilled automatically.
- Pluggable data providers: Alpaca, or a simulated `mock` provider for offline use.

> [!NOTE]
> On Alpaca's free plan, live data comes from the IEX exchange only (partial volume), and the UI says so. Complete-market history is available once it is at least 15 minutes old.

## Quick start

**Requirements:** Node.js 24 LTS (`.nvmrc`) · [Bun](https://bun.sh) 1.4 (package manager only) · Docker (for PostgreSQL 18) · a free [Alpaca](https://alpaca.markets) account (paper-trading keys work), or the mock provider.

```bash
bun install
cp .env.example .env          # fill in ALPACA_KEY_ID and ALPACA_SECRET_KEY
bun run db:up                 # Postgres on 127.0.0.1:5432
bun run dev                   # → http://127.0.0.1:5173
```

Migrations run automatically on startup. Add a symbol in the sidebar to start streaming.

> [!TIP]
> **No Alpaca keys?** Set `MARKET_PROVIDER=mock` in `.env` for simulated, deterministic market data.

<details>
<summary><b>Run the full stack in Docker</b></summary>

```bash
cp .env.example .env          # fill in keys or set MARKET_PROVIDER=mock
docker compose up -d --build --wait
```

Open http://127.0.0.1:3000. Ports are published on `127.0.0.1` only. Screenshot import and the AI features need tools on the host, so they aren't available inside the container.

</details>

## Optional extras

| Feature | Needs | Setup |
|---|---|---|
| AI outlook & stock ideas | [Claude Code](https://claude.com/code) + a Claude subscription | Run `claude` once and `/login` |
| Screenshot import | [Ollama](https://ollama.com) | `ollama pull qwen3-vl:8b-instruct`, then keep Ollama running. A read takes seconds on a GPU or Apple Silicon |

## Configuration

Settings live in `.env`. Invalid or missing values stop the server at startup with a message naming each variable.

<details>
<summary><b>All variables</b></summary>

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | `postgres://krestrel:krestrel@127.0.0.1:5432/krestrel` | Postgres for host runs (compose overrides it) |
| `MARKET_PROVIDER` | `alpaca` | `alpaca` or `mock` |
| `BACKFILL_DAYS` | `30` | Days of 1-minute history per symbol (intraday intervals) |
| `DAILY_HISTORY_YEARS` | `10` | Years of daily history per symbol (1D–1Y intervals) |
| `LOG_LEVEL` | `info` | `trace` … `fatal` |
| `ALPACA_KEY_ID`, `ALPACA_SECRET_KEY` | — | Required for `alpaca` |
| `ALPACA_STREAM_FEED` | `iex` | `iex` (free) or `sip` (paid) |
| `ALPACA_TRADING_URL` | `https://paper-api.alpaca.markets` | Clock and asset lookup. Use `https://api.alpaca.markets` with live-account keys. A trailing `/v2` is fine |
| `LLM_PROVIDER` | `claude-cli` | `claude-cli` or `none` |
| `CLAUDE_CLI_PATH`, `CLAUDE_MODEL`, `CLAUDE_TIMEOUT_MS` | `claude`, CLI default, `180000` | CLI location, default model (the in-app picker overrides it), and default timeout |
| `OLLAMA_URL`, `OLLAMA_VISION_MODEL` | `http://127.0.0.1:11434`, `qwen3-vl:8b-instruct` | Local Ollama and the vision model for screenshot import. Loopback URLs only |
| `MOCK_SEED`, `MOCK_TICK_MS` | `42`, `1000` | Mock provider seed and tick interval |
| `POSTGRES_*`, `APP_PORT` | see `.env.example` | Docker Compose settings |

</details>

## Commands

| Command | What it does |
|---|---|
| `bun run dev` | Dev server on 127.0.0.1:5173 |
| `bun run build` · `bun run start` | Production build · serve |
| `bun run typecheck` · `lint` · `format` | Types · Biome lint · Biome format |
| `bun run test` | Unit, component and DB tests (needs `db:up`). Use this, not `bun test` |
| `bun run db:up` · `db:down` | Start · stop Postgres |
| `bun run db:generate` · `db:migrate` · `db:studio` | Drizzle migrations and studio |

## Troubleshooting

<details>
<summary><b>Startup & data</b></summary>

| Symptom | Fix |
|---|---|
| "Invalid environment configuration" | Fix the listed variables; compare with `.env.example` |
| "server startup failed (is Postgres running?)" | `bun run db:up` |
| "Alpaca rejected the API keys" | Check the keys; paper keys need the paper `ALPACA_TRADING_URL`, live keys the live one |
| "Another app is already using your Alpaca stream" (406) | The free plan allows one stream connection. Close the other app or the second Krestrel (e.g. `dev` and Docker together); it retries every minute |
| Market status "unknown" or symbols can't be added | Trading API unreachable, or the wrong `ALPACA_TRADING_URL` for your keys |
| "Port 5173 is already in use" | Another dev server is running; Krestrel won't start a second one, so it never opens a second upstream connection |
| Only USD in the currency menu | Exchange rates couldn't load; check the server log for `exchange rate refresh failed`, then restart `bun run dev` |
| Code change to the market hub not picked up | Restart `bun run dev` (the hub survives hot reload on purpose) |

</details>

<details>
<summary><b>AI & screenshot import</b></summary>

| Symptom | Fix |
|---|---|
| "Claude Code isn't signed in" | Run `claude` in a terminal and `/login` |
| "Claude Code isn't installed here" | Install Claude Code, or set `CLAUDE_CLI_PATH`. On Windows, Krestrel finds `claude.exe` via PATH or npm's `claude.cmd`; otherwise point `CLAUDE_CLI_PATH` at `claude.exe` |
| "Screenshot import needs Ollama running" / "isn't downloaded yet" | Install Ollama, run `ollama pull qwen3-vl:8b-instruct`, and keep it running. The first read after a break loads the model (~1–2 min) |

</details>

## Project docs

[`CLAUDE.md`](CLAUDE.md) is the entry point for contributors and AI agents. Detailed guidelines and decision records live in [`ai/`](ai/README.md). Brand assets are in [`public/brand/`](public/brand).
