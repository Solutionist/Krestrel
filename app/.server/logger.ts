import pino from "pino";

import { env } from "./env";

/**
 * Safety net: values at these paths never reach log output (ai/conventions.md). Providers must
 * still never log their config or auth messages; this catches mistakes, it is not a licence.
 */
export const REDACT_PATHS = [
  "DATABASE_URL",
  ...["key", "secret", "token", "apiKey", "password", "authorization"].flatMap((name) => [
    name,
    `*.${name}`,
  ]),
  // Env secrets by name, in case an env object or slice of it is logged.
  ...["ALPACA_KEY_ID", "ALPACA_SECRET_KEY", "TAVILY_API_KEY"].flatMap((name) => [
    name,
    `*.${name}`,
  ]),
  // Whole header objects: auth headers differ per provider, so none are ever logged.
  "headers",
  "*.headers",
];

// Development: pino-pretty as an in-process stream. (A `transport` target can't be resolved
// inside Vite's SSR module runner, and pino-pretty is a dev dependency absent from the
// production image, hence the dynamic import.) Production: JSON lines to stdout.
const destination =
  env.NODE_ENV === "development"
    ? (await import("pino-pretty")).default({ colorize: true, ignore: "pid,hostname,app" })
    : undefined;

export const logger = pino(
  {
    level: env.LOG_LEVEL,
    base: { app: "krestrel" },
    redact: { paths: REDACT_PATHS, censor: "[redacted]" },
  },
  destination,
);
