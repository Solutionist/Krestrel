/**
 * Earliest date the history APIs (/api/performance, /api/dividends-received) accept as a start:
 * bounds the work one request can cause. Callers clamp earlier trade dates to it.
 */
export const HISTORY_START = "1990-01-01";
