import { type Env, parseEnv } from "./env-schema";

try {
  // Loads ./.env into process.env without overriding variables that are already set (Node ≥ 21.7).
  process.loadEnvFile();
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}

/** Validated at import, so the server fails fast at startup with a readable message. */
export const env: Env = parseEnv(process.env);
