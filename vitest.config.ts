import { defineConfig } from "vitest/config";

// Kept separate from vite.config.ts so the reactRouter() plugin (app dev/build only) never loads in tests.
// Inline projects inherit this root config (Vitest 5 `extends` default), so shared settings live here.
// Tests that need the real Postgres test database (run by the `db` project only).
const DB_TESTS = [
  "app/.server/market/db/**/*.test.ts",
  "app/.server/market/hub.test.ts",
  "app/.server/market/alert-engine.test.ts",
  "app/.server/market/backfill.test.ts",
  "app/.server/market/daily-closes.test.ts",
];

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    // Server modules read NODE_ENV; keep test runs out of development-only paths (pino-pretty).
    env: { NODE_ENV: "test" },
    projects: [
      {
        test: {
          name: "unit",
          environment: "node",
          include: ["app/**/*.test.ts", "tests/unit/**/*.test.ts"],
          exclude: DB_TESTS,
        },
      },
      {
        test: {
          name: "db",
          environment: "node",
          include: DB_TESTS,
          globalSetup: ["./tests/db/global-setup.ts"],
          // Files share one database and truncate between tests.
          fileParallelism: false,
        },
      },
      {
        test: {
          name: "dom",
          environment: "jsdom",
          include: ["app/**/*.test.tsx", "tests/unit/**/*.test.tsx"],
          setupFiles: ["./tests/setup-dom.ts"],
        },
      },
    ],
  },
});
