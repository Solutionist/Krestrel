import { asc, eq, sql } from "drizzle-orm";

import { formatShares } from "~/lib/format";
import { computePositions, type Trade, type TradeInput } from "~/lib/portfolio";
import type { Database } from "../client";
import { portfolios, trades } from "../schema";

export interface Portfolio {
  id: string;
  name: string;
}

export type PortfolioWriteResult =
  | { ok: true; portfolio: Portfolio }
  | { ok: false; code: "duplicate" | "not_found"; message: string };

export type TradeWriteResult =
  | { ok: true }
  | { ok: false; code: "not_found" | "oversell"; message: string };

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

const PORTFOLIOS_LOCK = sql`SELECT pg_advisory_xact_lock(hashtext('krestrel.portfolios'))`;

export function listPortfolios(db: Database): Promise<Portfolio[]> {
  return db
    .select({ id: portfolios.id, name: portfolios.name })
    .from(portfolios)
    .orderBy(asc(portfolios.createdAt), asc(portfolios.name));
}

/** Names are unique ignoring case; checked under a lock so concurrent creates can't collide. */
async function nameTaken(tx: Transaction, name: string, exceptId?: string): Promise<boolean> {
  const rows = await tx
    .select({ id: portfolios.id })
    .from(portfolios)
    .where(sql`lower(${portfolios.name}) = lower(${name})`);
  return rows.some((row) => row.id !== exceptId);
}

function duplicate(name: string): PortfolioWriteResult {
  return {
    ok: false,
    code: "duplicate",
    message: `A portfolio named “${name}” already exists (names ignore case).`,
  };
}

export function createPortfolio(db: Database, name: string): Promise<PortfolioWriteResult> {
  return db.transaction(async (tx) => {
    await tx.execute(PORTFOLIOS_LOCK);
    if (await nameTaken(tx, name)) return duplicate(name);
    const [portfolio] = await tx
      .insert(portfolios)
      .values({ name })
      .returning({ id: portfolios.id, name: portfolios.name });
    if (!portfolio) throw new Error(`Insert of portfolio ${name} returned no row`);
    return { ok: true, portfolio };
  });
}

export function renamePortfolio(
  db: Database,
  id: string,
  name: string,
): Promise<PortfolioWriteResult> {
  return db.transaction(async (tx) => {
    await tx.execute(PORTFOLIOS_LOCK);
    if (await nameTaken(tx, name, id)) return duplicate(name);
    const [portfolio] = await tx
      .update(portfolios)
      .set({ name })
      .where(eq(portfolios.id, id))
      .returning({ id: portfolios.id, name: portfolios.name });
    return portfolio
      ? { ok: true, portfolio }
      : { ok: false, code: "not_found", message: "That portfolio no longer exists." };
  });
}

/** Deletes the portfolio and its trades. Returns false when it did not exist. */
export async function deletePortfolio(db: Database, id: string): Promise<boolean> {
  const removed = await db
    .delete(portfolios)
    .where(eq(portfolios.id, id))
    .returning({ id: portfolios.id });
  return removed.length > 0;
}

function toTrade(row: typeof trades.$inferSelect): Trade {
  return {
    id: row.id,
    portfolioId: row.portfolioId,
    symbol: row.symbol,
    side: row.side,
    shares: row.shares,
    price: row.price,
    fee: row.fee,
    tradedOn: row.tradedOn,
    createdAt: row.createdAt.toISOString(),
  };
}

/** All trades, newest trade date first. */
export async function listTrades(db: Database): Promise<Trade[]> {
  const rows = await db
    .select()
    .from(trades)
    .orderBy(sql`${trades.tradedOn} DESC`, sql`${trades.createdAt} DESC`);
  return rows.map(toTrade);
}

/**
 * Runs `write` only if the portfolio's trades, with `change` applied, never sell more shares than
 * were held. Serialized per portfolio so two concurrent sells can't both pass the check.
 */
function writeChecked(
  db: Database,
  portfolioId: string,
  change: (current: Trade[]) => Trade[] | null,
  write: (tx: Transaction) => Promise<void>,
): Promise<TradeWriteResult> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext('krestrel.trades:' || ${portfolioId}))`,
    );
    const exists = await tx
      .select({ id: portfolios.id })
      .from(portfolios)
      .where(eq(portfolios.id, portfolioId));
    if (exists.length === 0) {
      return { ok: false, code: "not_found", message: "That portfolio no longer exists." };
    }
    const current = (await tx.select().from(trades).where(eq(trades.portfolioId, portfolioId))).map(
      toTrade,
    );
    const next = change(current);
    if (!next) return { ok: false, code: "not_found", message: "That trade no longer exists." };
    const result = computePositions(next);
    if (!result.ok) {
      const { symbol, tradedOn, held, selling } = result.oversell;
      return {
        ok: false,
        code: "oversell",
        message: `On ${tradedOn} you held ${formatShares(held)} ${symbol}, so you can't sell ${formatShares(selling)}. Check the dates and share counts.`,
      };
    }
    await write(tx);
    return { ok: true };
  });
}

/** Placeholder id/time for the trade being validated; the database assigns the real ones. */
function draft(portfolioId: string, input: TradeInput): Trade {
  return { ...input, id: "draft", portfolioId, createdAt: new Date().toISOString() };
}

export function addTrade(
  db: Database,
  portfolioId: string,
  input: TradeInput,
): Promise<TradeWriteResult> {
  return writeChecked(
    db,
    portfolioId,
    (current) => [...current, draft(portfolioId, input)],
    async (tx) => {
      await tx.insert(trades).values({ ...input, portfolioId });
    },
  );
}

async function portfolioOf(db: Database, tradeId: string): Promise<string | null> {
  const [row] = await db
    .select({ portfolioId: trades.portfolioId })
    .from(trades)
    .where(eq(trades.id, tradeId));
  return row?.portfolioId ?? null;
}

const missingTrade: TradeWriteResult = {
  ok: false,
  code: "not_found",
  message: "That trade no longer exists.",
};

export async function updateTrade(
  db: Database,
  tradeId: string,
  input: TradeInput,
): Promise<TradeWriteResult> {
  const portfolioId = await portfolioOf(db, tradeId);
  if (!portfolioId) return missingTrade;
  return writeChecked(
    db,
    portfolioId,
    (current) =>
      current.some((trade) => trade.id === tradeId)
        ? current.map((trade) => (trade.id === tradeId ? { ...trade, ...input } : trade))
        : null,
    async (tx) => {
      await tx.update(trades).set(input).where(eq(trades.id, tradeId));
    },
  );
}

/** Deleting a buy is refused when later sells would then exceed the shares held. */
export async function deleteTrade(db: Database, tradeId: string): Promise<TradeWriteResult> {
  const portfolioId = await portfolioOf(db, tradeId);
  if (!portfolioId) return missingTrade;
  return writeChecked(
    db,
    portfolioId,
    (current) =>
      current.some((trade) => trade.id === tradeId)
        ? current.filter((trade) => trade.id !== tradeId)
        : null,
    async (tx) => {
      await tx.delete(trades).where(eq(trades.id, tradeId));
    },
  );
}
