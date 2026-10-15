import { logger } from "../logger";
import { FxHistoryCache } from "./history";
import { FxRateCache } from "./rates";

/** The process-wide exchange-rate cache (one upstream request per refresh, shared by all pages). */
export const fxRates = new FxRateCache({ logger });

/** The process-wide cache of past daily rates, one series per currency (ADR 0027). */
export const fxHistory = new FxHistoryCache({ logger });
