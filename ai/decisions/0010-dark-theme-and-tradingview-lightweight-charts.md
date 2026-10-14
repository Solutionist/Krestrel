# 0010: Dark theme only; TradingView Lightweight Charts

- Status: accepted (owner decision, 2026-10-14); the "dark theme only" part is superseded by ADR 0015 (light + dark navy themes)
- Date: 2026-10-14

## Context

The owner asked for a dark theme that is easy to use, and whether TradingView's chart can be used. TradingView offers three products (tradingview.com/free-charting-libraries, checked 2026-10-14):

| Product | Licence | Personal use | Shows our data |
|---|---|---|---|
| Lightweight Charts | Apache 2.0, open source | Yes | Yes (we feed it) |
| Advanced Charts / Trading Platform | Proprietary, by application | **No**: "we don't provide the Advanced Charts and the Trading Platform libraries for personal use, hobbies, studies, or testing … only available to companies for use in public web projects". The library must also not sit in a public repository | Yes |
| Embeddable widgets | Free with attribution | Yes | **No**: they load TradingView's own data feed from TradingView's servers |

## Decision

- Charting uses **TradingView Lightweight Charts 5.2** (already planned). It is the only TradingView option that is both licensable for a personal app and able to draw Krestrel's own recorded bars (SIP history + live IEX). The TradingView attribution link stays enabled (`layout.attributionLogo`, default on).
- Widgets are rejected: they would bypass our data, history, and alert engine, and send symbol requests to a third party.
- **Dark theme only.** No light theme and no `prefers-color-scheme` switching (overrides the original prompt's light-theme requirement). `color-scheme: dark` is set on `<html>` so native controls and scrollbars match.

## Consequences

- Chart features are what Lightweight Charts offers: candles, volume, crosshair, zoom/scroll, panes, markers (used for fired alerts). No built-in drawing tools or indicators. Simple indicators (e.g. moving averages) can be computed from our bars and drawn as line series later.
- One palette to design and test; contrast is checked against the dark background only.
- If Krestrel ever became a public service, Advanced Charts could be applied for; the data contract (`Candle`, `/api/bars`, SSE `bar`) would not change.
