/**
 * The DB test database: TEST_DATABASE_URL if set, otherwise DATABASE_URL (from env or .env) with
 * `_test` appended to the database name. Tests never touch the dev database.
 */
export function testDatabaseUrl(): string {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;
  try {
    process.loadEnvFile();
  } catch {
    // No .env file: fall back to the docker compose defaults below.
  }
  const url = new URL(
    process.env.DATABASE_URL ?? "postgres://krestrel:krestrel@127.0.0.1:5432/krestrel",
  );
  url.pathname = `${url.pathname.slice(1)}_test`;
  return url.toString();
}
