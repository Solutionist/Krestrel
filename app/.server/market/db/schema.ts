import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

// Relative (not `~/`) because drizzle-kit loads this file without the tsconfig path alias.
import { type IdeaCategory, SECTORS, type Sector } from "../../../lib/ideas";
import type { BarSource } from "../../../lib/market";

// Prices: numeric(14,4) in Postgres, `number` in TypeScript (ADR 0008). Four decimals and
// magnitudes < 10^10 round-trip exactly enough through a double for display and alert comparison.
const price = (name: string) => numeric(name, { precision: 14, scale: 4, mode: "number" });
const utc = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const watchlist = pgTable("watchlist", {
  symbol: text("symbol").primaryKey(),
  position: integer("position").notNull(),
  addedAt: utc("added_at").notNull().defaultNow(),
});

export const bars1m = pgTable(
  "bars_1m",
  {
    symbol: text("symbol").notNull(),
    source: text("source").$type<BarSource>().notNull(),
    /** Bar open time, UTC. */
    ts: utc("ts").notNull(),
    open: price("open").notNull(),
    high: price("high").notNull(),
    low: price("low").notNull(),
    close: price("close").notNull(),
    volume: bigint("volume", { mode: "number" }).notNull(),
    tradeCount: integer("trade_count"),
    vwap: price("vwap"),
  },
  (t) => [primaryKey({ columns: [t.symbol, t.source, t.ts] })],
);

/**
 * Daily history for 1D…1Y charts (ADR 0011): years of 1-minute bars would be far too large.
 * `day` is the New York trading date; prices are split-adjusted.
 */
export const bars1d = pgTable(
  "bars_1d",
  {
    symbol: text("symbol").notNull(),
    source: text("source").$type<BarSource>().notNull(),
    day: date("day", { mode: "string" }).notNull(),
    open: price("open").notNull(),
    high: price("high").notNull(),
    low: price("low").notNull(),
    close: price("close").notNull(),
    volume: bigint("volume", { mode: "number" }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.symbol, t.source, t.day] })],
);

export const alerts = pgTable(
  "alerts",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    symbol: text("symbol")
      .notNull()
      .references(() => watchlist.symbol, { onDelete: "cascade" }),
    direction: text("direction").$type<"above" | "below">().notNull(),
    price: price("price").notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: utc("created_at").notNull().defaultNow(),
    triggeredAt: utc("triggered_at"),
    triggerPrice: price("trigger_price"),
  },
  (t) => [
    check("alerts_direction_check", sql`${t.direction} IN ('above', 'below')`),
    index("alerts_active_symbol_idx").on(t.symbol).where(sql`${t.active}`),
  ],
);

export const portfolios = pgTable("portfolios", {
  id: uuid("id").primaryKey().default(sql`uuidv7()`),
  name: text("name").notNull().unique(),
  createdAt: utc("created_at").notNull().defaultNow(),
});

/**
 * Buy and sell trades per portfolio, in USD (US listings). Positions and realized P/L are derived
 * by replaying trades in date order with the average-cost method (`app/lib/portfolio.ts`).
 */
export const trades = pgTable(
  "trades",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    portfolioId: uuid("portfolio_id")
      .notNull()
      .references(() => portfolios.id, { onDelete: "cascade" }),
    symbol: text("symbol").notNull(),
    side: text("side").$type<"buy" | "sell">().notNull(),
    /** Fractional shares are allowed (many brokers sell them). */
    shares: numeric("shares", { precision: 18, scale: 6, mode: "number" }).notNull(),
    price: price("price").notNull(),
    fee: price("fee").notNull().default(0),
    /** Trade date (New York). */
    tradedOn: date("traded_on", { mode: "string" }).notNull(),
    createdAt: utc("created_at").notNull().defaultNow(),
  },
  (t) => [
    check("trades_side_check", sql`${t.side} IN ('buy', 'sell')`),
    check("trades_shares_check", sql`${t.shares} > 0`),
    check("trades_price_check", sql`${t.price} >= 0`),
    check("trades_fee_check", sql`${t.fee} >= 0`),
    index("trades_portfolio_symbol_idx").on(t.portfolioId, t.symbol),
  ],
);

/**
 * Sector and type per ticker, for grouping holdings (ADR 0019). Filled by the owner's local model;
 * rows with source "owner" are the owner's corrections and the model never overwrites them.
 */
export const stockProfiles = pgTable(
  "stock_profiles",
  {
    symbol: text("symbol").primaryKey(),
    /** GICS sector; null for funds/ETFs or when unknown. */
    sector: text("sector").$type<Sector>(),
    style: text("style").$type<IdeaCategory>(),
    source: text("source").$type<"model" | "owner">().notNull(),
    updatedAt: utc("updated_at").notNull().defaultNow(),
  },
  (t) => [
    check("stock_profiles_source_check", sql`${t.source} IN ('model', 'owner')`),
    check("stock_profiles_style_check", sql`${t.style} IN ('growth', 'dividend', 'risky')`),
    // The 11 GICS sectors the app knows; anything else would have no group label.
    check(
      "stock_profiles_sector_check",
      sql`${t.sector} IN (${sql.raw(SECTORS.map((sector) => `'${sector}'`).join(", "))})`,
    ),
  ],
);

/**
 * The owner's correction of a dividend received (ADR 0025): the cash that actually arrived, in
 * USD after any withholding, for one payout (by ex-date) of one stock in one portfolio. Without a
 * row the amount is derived from the provider's payouts and the shares held before the ex-date.
 */
export const dividendOverrides = pgTable(
  "dividend_overrides",
  {
    portfolioId: uuid("portfolio_id")
      .notNull()
      .references(() => portfolios.id, { onDelete: "cascade" }),
    symbol: text("symbol").notNull(),
    exDate: date("ex_date", { mode: "string" }).notNull(),
    amount: price("amount").notNull(),
    updatedAt: utc("updated_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.portfolioId, t.symbol, t.exDate] }),
    check("dividend_overrides_amount_check", sql`${t.amount} >= 0`),
  ],
);

/** Target weight per stock in a portfolio, in percent of its value (ADR 0026). */
export const portfolioTargets = pgTable(
  "portfolio_targets",
  {
    portfolioId: uuid("portfolio_id")
      .notNull()
      .references(() => portfolios.id, { onDelete: "cascade" }),
    symbol: text("symbol").notNull(),
    weight: numeric("weight", { precision: 7, scale: 4, mode: "number" }).notNull(),
    updatedAt: utc("updated_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.portfolioId, t.symbol] }),
    check("portfolio_targets_weight_check", sql`${t.weight} > 0 AND ${t.weight} <= 100`),
  ],
);
