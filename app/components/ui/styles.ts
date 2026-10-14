// Shared class recipes for the Krestrel design system (ai/ui.md "Design system", ADR 0015).
// Radius scale: cards 16px (rounded-2xl), popovers 12px (rounded-xl), controls 8–10px
// (rounded-lg / rounded-md), dots and avatars full. One accent (`accent`); rise/fall only for
// price direction, always with ▲/▼.

/** Top-level surfaces: sidebar, main content, tables, stat groups. */
export const CARD = "rounded-2xl bg-panel shadow-card ring-1 ring-rule/70";

/** Menus, dropdowns, floating readouts. */
export const POPOVER = "rounded-xl bg-raised p-1 shadow-pop ring-1 ring-rule animate-pop-in";

/** Text inputs and selects. Pair with h-8 (compact) or h-9 (forms). */
export const FIELD =
  "rounded-lg bg-panel px-2.5 text-sm text-text ring-1 ring-inset ring-rule transition-shadow duration-150 placeholder:text-muted/70 hover:ring-muted/40 focus:outline-none focus:ring-2 focus:ring-accent/60";

/** Small caption above a field or stat. */
export const LABEL = "text-xs font-medium text-muted";

/** Section heading inside a card. */
export const HEADING = "text-sm font-semibold tracking-tight text-text";

/** Price-direction text colour; zero/unknown stays muted. */
export function toneOf(value: number | null | undefined): string {
  if (value == null || Math.abs(value) < 1e-9) return "text-muted";
  return value > 0 ? "text-rise" : "text-fall";
}
