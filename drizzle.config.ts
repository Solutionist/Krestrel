import { defineConfig } from "drizzle-kit";

// drizzle-kit loads .env itself (bundled dotenv), so DATABASE_URL comes from there or the shell.
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set. Copy .env.example to .env.");

export default defineConfig({
  dialect: "postgresql",
  schema: "./app/.server/market/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url },
  strict: true,
  verbose: true,
});
