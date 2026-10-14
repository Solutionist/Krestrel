import { logger } from "../logger";
import { FxRateCache } from "./rates";

/** The process-wide exchange-rate cache (one upstream request per refresh, shared by all pages). */
export const fxRates = new FxRateCache({ logger });
