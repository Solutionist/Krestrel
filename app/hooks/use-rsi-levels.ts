import { DEFAULT_RSI_LEVELS, RsiLevelsSchema } from "~/lib/rsi-signal";

import { createStoredValue } from "./stored-value";

/** Overbought/oversold levels, one setting for every stock and chart (ADR 0014). */
export const rsiLevels = createStoredValue(
  "krestrel.rsiLevels",
  DEFAULT_RSI_LEVELS,
  (raw) => {
    try {
      const parsed = RsiLevelsSchema.safeParse(JSON.parse(raw));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  },
  (levels) => JSON.stringify(levels),
);
