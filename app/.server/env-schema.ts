import * as z from "zod";

const LOG_LEVELS = ["trace", "debug", "info", "warn", "error", "fatal", "silent"] as const;

// App-wide settings only. Provider-specific variables (API keys, feeds, URLs) are validated by
// each provider's own config schema when the registry creates it (ADR 0009).
const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/, error: "must be a postgres:// URL" }),
  LOG_LEVEL: z.enum(LOG_LEVELS).default("info"),
  MARKET_PROVIDER: z
    .string()
    .regex(/^[a-z][a-z0-9_-]*$/, { error: "must be a provider id such as alpaca or mock" })
    .default("alpaca"),
  BACKFILL_DAYS: z.coerce.number().int().min(0).max(365).default(30),
  /** Years of daily bars for 1D…1Y charts (ADR 0011). Alpaca SIP history starts in 2016. */
  DAILY_HISTORY_YEARS: z.coerce.number().int().min(0).max(30).default(10),
});

export type Env = z.infer<typeof EnvSchema>;

export class ConfigError extends Error {
  override name = "ConfigError";
}

/**
 * Validates `source` against `schema`. Throws `ConfigError` listing every problem by variable
 * name, never echoing values. Empty strings (e.g. `KEY=` copied from .env.example) mean "unset".
 */
export function parseConfig<T extends z.ZodType>(
  schema: T,
  source: Readonly<Record<string, string | undefined>>,
  label: string,
): z.output<T> {
  const cleaned = Object.fromEntries(Object.entries(source).filter(([, value]) => value !== ""));
  const result = schema.safeParse(cleaned);
  if (result.success) return result.data;
  const lines = result.error.issues.map(
    (issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`,
  );
  throw new ConfigError(
    `Invalid ${label} configuration:\n${lines.join("\n")}\nCopy .env.example to .env and fill it in.`,
  );
}

export function parseEnv(source: Readonly<Record<string, string | undefined>>): Env {
  return parseConfig(EnvSchema, source, "environment");
}
