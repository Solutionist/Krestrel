# 0015: Krestrel's own visual language: blue-clean, light and dark navy, Geist

- Status: accepted (owner decisions, 2026-10-14). Supersedes the "dark theme only" part of ADR 0010.
- Date: 2026-10-14

## Context

The owner found the UI "way too close to a trading desk/TradingView", the IBM Plex type "too rigid", and the whole thing "rusty and made in a hurry". They asked for Krestrel's own style, "more blue-clean". Two choices were made with the owner: **both a light theme and a dark navy theme, with a switch** (following the OS by default), and **Geist** as the typeface.

## Decision

- **Visual language:** calm fintech, not a terminal. The app canvas (`ink`) holds floating cards (`panel`, `rounded-2xl`, soft tinted shadow `shadow-card`, hairline `ring-rule`): sidebar and main content are cards with a 12 px gap, instead of edge-to-edge panes split by borders. Lists are inset rounded rows; selection is a soft accent tint, not a bar. One accent (blue `accent`); `rise`/`fall` (green/red, always with ▲/▼) are reserved for price direction and P/L.
- **Themes:** light is the default token set; `html[data-theme="dark"]` swaps every token to a dark navy palette (never pure black). An inline script in `<head>` resolves the saved preference (`krestrel.theme`: system | light | dark) before first paint, so there is no flash; `useApplyTheme` keeps it in sync with the OS. The canvas chart reads tokens at creation, so the Markets page remounts it when the theme changes (`useThemeVersion`); the initial theme never causes a remount.
- **Type:** Geist Variable for everything, including numbers (`tabular-nums` keeps columns aligned); Geist Mono only for code. Weights 400/500/600, sentence case, no all-caps labels. Self-hosted via `@fontsource-variable/*` (no third-party requests).
- **Icons:** Phosphor (`@phosphor-icons/react`, `…Icon` exports), one family, 14–16 px.
- **Design system in code:** `app/components/ui/` (`Button`, `IconButton`, `ToggleChip`, `Segmented`, and class recipes `CARD`, `POPOVER`, `FIELD`, `LABEL`, `HEADING`, `toneOf`) and `AppShell`. New UI uses these rather than ad-hoc classes.
- **Colour-blind safety:** green/red replaces blue/orange for direction because blue is now the accent; direction is never colour-only (▲/▼ glyphs and screen-reader text).

## Consequences

- Every component and the chart must be checked in both themes. Lightweight Charts can't parse `color-mix()`, so chart colours keep coming from hex tokens via `withAlpha`.
- Switching theme reloads the chart's candles (a local request), which is acceptable for a rare action.
