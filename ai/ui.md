# UI

Status: redesigned (ADR 0015): Krestrel's own blue-clean language, light and dark navy themes with a switch, Geist type. TradingView Lightweight Charts (ADR 0010).

## Tokens (`app/app.css` `@theme`, ADR 0015)

Light is the default token set; `html[data-theme="dark"]` swaps every value (dark navy, never black). The theme (`krestrel.theme`: system | light | dark) is applied before first paint by `THEME_SCRIPT` in `root.tsx` and kept in sync by `useApplyTheme`; the switch is in the top bar.

| Token | Light / Dark | Use |
|---|---|---|
| `ink` | `#F3F6FB` / `#0A1222` | Canvas behind the cards |
| `panel` | `#FFFFFF` / `#0F192D` | Cards (sidebar, main), chart background |
| `raised` | `#FFFFFF` / `#15213A` | Popovers, menus, floating readouts |
| `subtle` | `#EDF2F9` / `#17233A` | Hover fills, segmented tracks, wells |
| `rule` | `#E1E8F2` / `#1E2C46` | Hairlines, card rings, chart grid |
| `text` / `muted` | `#0F1C30` `#5E6E87` / `#E6EDF8` `#8597B4` | Primary / secondary text |
| `accent` | `#2F6BDF` / `#5B8DFF` | The one accent: actions, selection, focus, links |
| `rise` / `fall` | `#0D9467` `#DC3F4A` / `#33C48F` `#FF6670` | Price direction and P/L only, always with ▲ / ▼ |
| `ind-1/2/3` | amber / violet / teal | Indicator lines (chart only) |
| `shadow-card`, `shadow-pop` | tinted per theme | Card and popover elevation |

The chart reads these CSS variables when it is created (`readChartTheme`); the Markets page remounts it when the theme changes (`useThemeVersion`). Lightweight Charts cannot parse `color-mix()`; convert with `withAlpha()`.

**Type:** Geist Variable for all UI text and numbers (`tabular-nums` on every number), Geist Mono only for code; self-hosted via `@fontsource-variable/*`. Weights 400/500/600; sentence case; no all-caps.

**Icons:** Phosphor (`@phosphor-icons/react`, `…Icon` exports), 14–16 px, regular weight (duotone for nav).

## Design system (`app/components/ui/`, `app-shell.tsx`)

- `AppShell`: top bar, optional banner, then sidebar card + main card floating on the canvas (`gap-3`), with a skip link to `#main`.
- `styles.ts`: `CARD` (rounded-2xl, panel, shadow-card, ring), `POPOVER` (rounded-xl, raised, shadow-pop, pop-in), `FIELD` (inputs/selects), `LABEL`, `HEADING`, `toneOf`.
- `button.tsx`: `Button` (primary | secondary | ghost | danger; sm | md), `IconButton` (required `label`), `ToggleChip` (aria-pressed, accent tint).
- `segmented.tsx`: `Segmented` (intervals, ranges, theme, side pickers).
- Radius scale: cards 16 px, popovers 12 px, controls 8–10 px, list rows 8 px. One accent. Lists are inset rounded rows; selection is `bg-accent/10`.

## Layout

```
 [K] Krestrel  (Markets)(Ideas)(Portfolio)  (● Market closed · opens Wed 09:30 ET)  USD▾ [☀ ☾ ▭] ● Live
 [banner card: only when reconnecting / error / offline]
╭ Watchlist 5/30  [sort▾][↓] ╮ ╭ NVDA  ▲ Buy signal · daily RSI 34 ─────────────────────────────╮
│ [⌕ Search ticker   ][Add] │ │ 225.23  (▼ −3.31 −1.45%) vs prev close                          │
│ ┌ NVDA        225.23 ┐    │ │ [1m 5m … │ 1D … 1Y] [≡ Indicators 3] (Buy/Sell)(S/R)(Plan) (Insights)(AI outlook)│
│ └ RSI 47  ▼ −3.31 −1.45%┘ │ │ legend ┌ chart + volume + RSI pane ─────┐ │ AI outlook or       │
│   AAPL        196.66      │ │        └────────────────────────────────┘ │ Insights column     │
│   …                       │ │                          ⇔ Select range ↶ − + ⟲ ?│                 │
╰───────────────────────────╯ ╰───────────────────────────────────────────────────────────────╯
```
Interval bar: `1m 5m 15m 30m 1h 4h │ 1D 1W 2W 1M 1Y` (TradingView-style; full names in `aria-label`/tooltip). Calendar intervals hide clock times; axis ticks show years, months, days, or times as Lightweight Charts zooms.

No separate date-range bar (owner: the interval bar is enough). Switching interval **keeps the same stretch of time on screen** (`captureWindow` / `windowToLogical` in `app/lib/chart-view.ts`): a view that follows the latest candle keeps following it; a coarser interval shows at least 20 candles ending at the same point; if the new interval has no data for that time (e.g. minute data older than BACKFILL_DAYS) it falls back to the default period. The same applies when downloaded history reloads the chart. The first load, Insights trading styles and Reset view use the interval's default period (`INTERVAL_RANGE` in `app/lib/chart-ranges.ts`: 1m→1 day, 5m/15m→5 days, 30m/1h→1 month, 4h→3 months, 1D→1 year, 1W/2W→5 years, 1M/1Y→all); Reset view (⟲ / `0`) returns to it.

Chart toolbar (`chart-toolbar.tsx`): interval segmented control · bar style "Candles · Heikin Ashi" (`krestrel.barStyle`; Heikin Ashi smooths the bars only, every number shown stays the real price) · "Indicators · n" menu (checkbox list; saved in `krestrel.indicators`) · "Buy/Sell", "S/R" and "Plan" toggles (`krestrel.overlays`) · "Insights" and "AI outlook" toggles for the side column (`krestrel.sidePanel`: outlook | insights | none, default outlook; one column at a time). Indicators: EMA 20/50/100, Bollinger Bands (20, 2; translucent, dashed middle) on the price pane; RSI 14 in a second pane (25 %, fixed 0–100, faint 70/30 guides). RSI pane (`rsi-pane.ts`, ADR 0014): shaded zones above overbought (red) and below oversold (green), dotted level lines with axis labels, faint 50 line, Buy/Sell markers where RSI leaves a zone (latest labelled, older small); levels edited under Indicators → "RSI levels · all stocks" (`krestrel.rsiLevels`). Daily RSI(14) signals (`RsiSignalBadge`): in plain words under each watchlist symbol and in the holdings Signal column ("▲ Oversold", "▲ Turning up", "▼ Turning down", "▼ Overbought", "Steady", "No signal yet"; the RSI number is in the tooltip), as a chip in the chart header ("▲ Buy signal · daily RSI 34"), and in a Signal column on the portfolio holdings; tooltips give the one-sentence reason and "not financial advice". Watchlist can sort by RSI (most oversold first). Indicator values appear in the **legend** (`chart-legend.tsx`, top-left: O/H/L/C, change, volume, indicator values at the crosshair or latest candle; a "Heikin Ashi" tag in that style), not as axis labels. Maths in `app/lib/indicators.ts` (TradingView conventions). Prices are formatted per series (`PRICE_FORMAT`).

Analysis overlays (ADR 0012, 0016): "Buy/Sell" draws ▲ `T1` below the entry bar and ▼ `T1 +24%` above the exit (hindsight); "S/R" draws dashed S1…/R1… lines and a large-dashed trend-support line (muted when broken); "Plan" draws the forward plan as price lines on the candles: buy zone low and high (accent, dashed, "Buy"), stop (fall, dotted, "Stop"), targets (rise, dotted, "T1"/"T2"/"T3"). The plan lines come from the AI outlook when one is done for this symbol and interval and has levels, otherwise from the local plan (`buildTradePlan` in `app/lib/trade-plan.ts`).

The **Insights** column (`insights-panel.tsx`, `#chart-insights`, `w-80`, beside the chart, never over it; local, no AI) starts with a **trading style** picker (`HORIZONS` in `app/lib/chart-ranges.ts`: Day trade → 5-minute candles over 5 sessions, Swing → 1-hour over a month, Position → 1-day over a year, Long term → 1-week over 5 years); picking one switches the chart interval, and Insights and the AI outlook analyse only that interval's period (`analysisWindow`), so markers and plans match the chart. Any other interval shows as "Custom". Then a **Plan** section (forward-looking): bias chip (▲ Uptrend / Sideways / ▼ Downtrend), Buy zone `low – high`, Stop and Targets, each with % from the last price and its basis (e.g. "S1 support"), Reward : risk `2.4 : 1`; in a downtrend "No buy zone while it's falling; wait for a higher low."; a "Show on chart" chip toggles the Plan overlay; caption "From this chart's levels. A plan, not advice." Then **Past swings**: each round trip with compact ET times, prices, return, bars held and entry facts (`describePoint`); clicking one zooms the chart to it. Support/resistance and trend support follow. Footer "Get AI outlook" switches the column to the outlook.

**AI outlook** (ADR 0016, 0020; `outlook-panel.tsx`, `#chart-outlook`, open by default): idle explainer naming the chosen model (Claude reads recent news and analyst ratings with web search; a local model reads the feed headlines, plus Tavily results when `TAVILY_API_KEY` is set), plus Krestrel's levels, and returns sentiment and a buy/sell plan; while working a skeleton and "Reading news and analyst ratings…"; errors inline. Result: **Sentiment** (5-step bearish → bullish meter, chosen step tinted fall / muted / rise, label and summary); **Plan** (stance chip: ▲ Buy now / Wait for a pullback / Hold / ▼ Take profit / ▼ Avoid; buy zone, stop, targets with % vs the last price; rationale; "Show on chart"); **Analysts** (consensus chip, price-target range bar low → high with mean and current price markers, count, as-of date, note); **News** (▲ positive / ▼ negative / ● neutral, headline links open in a new tab, source · date, why it matters); **Risks**. Footer: **Model** picker (shared `AiModelPicker`: "Default (…)" or the outlook's own Claude or local model, `krestrel.ai.overrides`), one action button ("Get outlook" / "Refresh outlook" / "Working… (model)"), attribution `provider · model · HH:MM · Feed headlines: N`, the research mode line and "Not financial advice." It calls `POST /api/outlook/:symbol` with the analysed candles and `ai`; with Claude, first use asks consent (`krestrel.claudeConsent`: the ticker, this chart's prices and recent headlines go to Anthropic via your Claude Code CLI; Claude also searches the web). The outlook resets when the symbol or interval changes; a late answer for another chart is dropped.

Chart navigation (TradingView-like): wheel/pinch zoom, drag to pan (kinetic), **older history loads automatically** when the view reaches the first bar (`fixLeftEdge`, chunk = the interval's default look-back, view preserved), 6-bar right margin, zoom-out down to `minBarSpacing` 0.05. Bottom bar: Select range, ↶, − / + / ⟲ buttons (zoom anchored on the latest bar when visible, else the view centre; never wider than the data). Focused chart (`role="application"`): `+`/`−` zoom, `←`/`→` pan (never past the latest bar), `0` reset. **Select range** (bottom bar, TradingView's zoom tool; **Shift+drag** does the same any time): drag from the start of a period to its end; a band and readout show change (first open → last close, ▲/▼ + %), bars, start → end (ET), high/low (`rangeStats` in `app/lib/range-stats.ts`); release zooms in and turns the tool off, a click without a drag keeps it on, Esc cancels. While on, a transparent layer above the canvas takes the drag (crosshair cursor) instead of panning. **↶ Previous view** (or Backspace) steps back through region and trade zooms (20 kept; reset when data reloads, shifted when older history is prepended). Double-click the time axis resets.

Accessible names are distinct: intervals are "<n> candles" (e.g. "1 year candles"), ranges "Last year", "Year to date", "All data".

Portfolio page (`/portfolio`, ADR 0013): same grid; the sidebar lists "All portfolios" (when there are several) and each portfolio with value and unrealized %, plus a create field. Amounts are in the display currency (top-bar ⇄ picker, converted at today's ECB rate with the rate, source and date shown under the page); the trade ledger stays in USD as recorded. Errors from the server (oversell, duplicate name) appear under the form that caused them. The dashboard header shows `≈ ฿…` beside the price when the display currency isn't USD.

Sidebar 15 rem (18 rem ≥ 1024 px). Verified at 1440 × 860 and 820 px wide. Selected symbol is in the URL (`?symbol=NVDA`).

## Ideas page (`/ideas`, ADR 0017)

5 to 10 stocks worth a look, by the chosen AI on an explicit click (Claude with web search, or a local model with Tavily results or its own knowledge; ADR 0017, 0020). Sidebar "Find ideas": focus picker as a radio list of rounded rows ("Diversify my portfolio", default, hint "Fill the sectors you're light on"; then the 11 GICS sectors by `SECTOR_SHORT` with a colour dot, full name as tooltip), the shared model picker (`AiModelPicker`, the ideas override in `krestrel.ai.overrides`), primary "Find ideas" / "Refresh ideas" / "Searching… (model)", footnote with the expected time and "Not financial advice." With Claude, first use asks for consent (`krestrel.ideasConsent`): only tickers and their share of the portfolio are sent, never amounts or share counts.

Main: "Stock ideas" + basis line ("Based on your portfolio" / "Based on your watchlist" / "No holdings yet: general ideas"), focus and generated time. **Your mix** (`bg-subtle/60` well): stacked bar of sector weights (one calm colour per sector, `SECTOR_COLORS`, never green/red), legend with %, the AI's summary, "Worth adding" chips (ToggleChip; click = that focus). Then **Growth / Dividend / Risky** (`IDEA_CATEGORY_LABELS` name + hint; Risky has a muted-fall `WarningIcon`), each a 1/2/3-column grid of idea cards: ticker + name, sector chip + exchange, price and ▲/▼ day change (live from the stream when watched, else the price captured with the idea; "—" when unknown), thesis, "Fits because …", "Risk: …", up to 3 metrics, http(s)-only source links (new tab), and "Watch" (fetcher → `/api/watchlist` add) or "Open chart" (`/?symbol=X`) when on the live watchlist. Empty category: one muted line. Idle: composed empty state with the three categories and the button; loading: skeleton cards + "Reading your mix and searching the market…"; errors inline (`WarningCircleIcon`, `text-fall`) above any earlier result. The last successful result per focus is kept in localStorage `krestrel.ideas` (`{ [focus]: IdeasResponse }`, each entry validated on load, restored after hydration) and replaced on refresh.

## Components

| File | Role |
|---|---|
| `app/routes/_index.tsx` | Dashboard; loader returns `hub.snapshot()` for SSR, then `useMarketStream` takes over. Under the chart, a dividend line for payers (one `/api/dividends` request for the whole watchlist; nothing for non-payers): "Dividend · Pays quarterly · $0.53/share (≈2.9% a year) · Next: buy before … (ex-dividend date), paid … · expected, not yet announced", plus "Last one: pays … to holders before …" while a payout is pending (ADR 0022) |
| `app/hooks/use-market-stream.ts` | `EventSource('/api/stream')`; React state updates ≤ 1×/frame; `onLive(listener)` delivers ticks/bars to the chart without re-rendering |
| `app/components/top-bar.tsx` | Brand, Markets/Ideas/Portfolio nav, market phase + next change in the viewer's local time with New York time in brackets, e.g. "opens Wed 20:30 (09:30 ET)" (`describeMarket(clock, useTimeZone(), now)`; server render and New York viewers see ET only), provider `liveDataLabel`, display-currency picker (`krestrel.currency`), connection dot |
| `app/hooks/use-currency.ts` | `useCurrency()`: shared display currency (external store over localStorage), one `/api/fx` request per page, `money(usd, signed?)`; USD until the rate is known |
| `app/components/portfolio/*` | `portfolio-list` (sidebar + create), `holdings-table` (open by value, then closed; symbol opens its chart; last column **Next dividend**: pay date of the payment a holder waits for, cash for your shares in the display currency, "expected" for estimates, "—" without a dividend, full sentence in the tooltip; ADR 0022), `trade-form` (Buy/Sell, ticker, shares, price USD with "use last price", fee, date; also edits), `trade-history` (USD ledger, edit/delete) |
| `app/routes/portfolio.tsx` | Portfolio page (`?p=<id>`, none = All): header and summary (Value, Unrealized, Today, Realized, Total P/L) on top, then tabs **Holdings · Trades · Average down** (`TabBar`, `app/components/ui/tab-bar.tsx`: ARIA tablist, ←/→/Home/End), then the rate note. The tab is kept in the URL as `?view=trades\|calculator` (Holdings has none), so reloads and portfolio switches keep it; `shouldRevalidate` skips the loader when only `view` changes (`onlyViewChanged` in `app/lib/portfolio-view.ts`), while the same URL again (the Portfolio link) still reloads. Holdings: grouping + Import screenshot, the table; pasting an image anywhere opens Holdings with the import panel, which stays mounted (hidden) on other tabs so a review in progress survives a tab switch, and scrolls into view once shown. Trades: form + ledger |
| `app/components/portfolio/dividend-income.tsx` | **Expected dividends** card under the portfolio summary (ADR 0022): a year (≈ a month), yield on value and on cost (priced holdings only, like the totals), next 90 days total and count, then the payments by date (date + "expected", stock, shares × per share, amount; first 8, "+N more"). A payout past its ex-date counts the shares held before it. "No dividend stocks in this portfolio." when nothing pays. Fed by `dividendTally` with the trades in view; the holdings column uses the same tally's next payment per stock |
| `app/components/portfolio/average-calculator.tsx` | Average-down (or up) calculator on the Average down tab: pick a holding (pre-fills shares, average cost, live price) or enter numbers; shows exact and whole shares to buy, cost (plus display-currency equivalent), new average, and a table for the buy price −5/−10/−15%. Maths: `sharesToReachAverage` in `app/lib/portfolio.ts` (fees included; explains unreachable targets) |
| `app/routes/ideas.tsx` | Ideas page: focus state, consent, `POST /api/ideas` (parsed with `IdeasResponseSchema`), per-focus results in `krestrel.ideas`; Your mix, three category sections, idle/loading/error |
| `app/components/ideas/*` | `ideas-sidebar` (focus radio list, model picker, Find ideas), `sector-mix` (stacked sector bar + legend, summary, Worth adding chips; `SECTOR_COLORS`), `idea-card` (idea card with live price, the dividend line at the bottom for payers (ADR 0022), Watch/Open chart; skeleton) |
| `app/components/watchlist/watchlist.tsx` | Add form (fetcher → `/api/watchlist`), listbox with roving tabindex, remove, reorder. Header sort control (My order / Symbol / Price / Change % / Change, ↑/↓ direction) via `sortSymbols()` in `app/lib/watchlist-sort.ts`; choice kept in localStorage `krestrel.watchlistSort`, unknown prices always last |
| `app/components/watchlist/symbol-search.tsx` | Add-symbol combobox: debounced `/api/assets` search, dropdown of ticker · company · exchange, "Added" for symbols already listed. Enter adds the highlighted listing, or the typed ticker if none |
| `app/components/watchlist/watchlist-row.tsx` | Symbol, price (flash), ▲/▼ change + %; `priceChange()` |
| `app/components/chart/price-chart.tsx` | Lightweight Charts; created once; `setData` on symbol/timeframe change; `update` once per frame for live data. Bar style (`krestrel.barStyle`: candles \| heikin-ashi) only changes the drawn bars: Heikin Ashi comes from `app/lib/heikin-ashi.ts` (full series on load, last bar only on live ticks); the legend's OHLC/change, volume colours, analysis and the AI outlook stay on real prices, the legend shows a "Heikin Ashi" tag, and the axis label is the real last price (dotted line) instead of the averaged close |
| `app/lib/candles.ts` | `bucketStart` (matches server SQL), `mergeTick`, `mergeBar`, NY-time formatters |
| `app/lib/status-text.ts` | Plain-language market and connection copy |

## States (all implemented)

| State | Where | Copy |
|---|---|---|
| Empty watchlist | Main + sidebar | "Add a symbol to start streaming" |
| Market closed / pre / after hours | Top bar + under price | "Market closed · opens Wed 09:30 ET" |
| Reconnecting (upstream) | Banner (signal) | Provider `reason` + "Retrying in N s." |
| Upstream error (auth, 406, wrong feed) | Banner (fall) | Provider `reason`, says what to fix |
| Browser lost the server | Banner + "Offline" | "Lost the connection to the Krestrel server. Reconnecting automatically…" |
| Symbol limit | Sidebar: input disabled | "Watchlist full (30 symbols, …). Remove one to add another." |
| Invalid / unknown / duplicate symbol | Under the input (`aria-live`) | Server message |
| No chart history yet | Chart overlay | "No history for X yet. It is being downloaded…" |

## Rules

- **Theme:** light and dark navy via tokens only (no `dark:` variants); check every change in both.
- **Direction:** calm blue-clean fintech, not a trading terminal; floating cards on a tinted canvas; no gradients; no all-caps labels.
- **Up/down:** colour + glyph + screen-reader text ("up +0.67%").
- **Motion:** price flash only (digits tint toward rise/fall and settle over 700 ms, no background), disabled under `prefers-reduced-motion`.
- **Chart time:** labels formatted in New York time via `tickMarkFormatter` / `localization.timeFormatter` (maintainers' guidance; timestamps are never shifted). Day boundaries on intraday axes follow UTC; daily candles are NY-midnight buckets. `timeVisible` is off for 1D.
- **Chart performance:** never `setData` on live data; `mergeTick`/`mergeBar` then one `update` per frame; a finished candle is flushed before a new bucket starts.
- `lightweight-charts` is imported only by client components and only touched inside effects (import is side-effect free on the server).

## Accessibility

- Add-symbol search: WAI-ARIA combobox (`role=combobox`, `aria-expanded`, `aria-activedescendant`); ↑/↓ move through results (wrapping back to the typed text), Enter adds, Escape closes (again: clears). Options never take focus.
- Watchlist: one tab stop; ↑/↓/Home/End move focus in displayed (sorted) order; Enter/Space opens the chart; Alt+↑/↓ reorders (only in "My order"); Delete/Backspace removes after confirmation. Visible accent focus ring everywhere.
- Timeframes are a `fieldset` of `aria-pressed` buttons. Remove buttons have accessible names.
- `aria-live` only for form feedback and (Phase 4) fired alerts — never for ticks.

## Copy

Plain, active voice, says what to do next. "Alpaca rejected the API keys. Check .env and restart." not "Authentication error occurred."

## Brand

Krestrel K mark (stem, rising stroke, leg, two candlesticks), emerald gradient #14e8a6 → #07805c; tagline "LOCAL TRADING PLATFORM". Assets in `public/brand/`: `krestrel-mark.svg` (header), `krestrel-logo.svg` (mark + wordmark, wordmark uses currentColor), `krestrel-icon-{dark,light}.svg`, PNG icons 180/192/512. `public/favicon.svg` / `favicon.ico` are the dark app icon. The UI accent stays blue: emerald is the rise colour.
