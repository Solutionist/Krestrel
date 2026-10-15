import pino from "pino";
import { describe, expect, it } from "vitest";

import type { AlertFired } from "~/lib/alerts";

import { setupTestDatabase } from "../../../tests/db/test-db";
import { AlertEngine } from "./alert-engine";
import { addToWatchlist } from "./db/queries/watchlist";

const db = setupTestDatabase();
const NOW = Date.parse("2026-10-14T18:00:00Z");

async function startedEngine() {
  const fired: AlertFired[] = [];
  const engine = new AlertEngine({
    db,
    logger: pino({ level: "silent" }),
    emit: (alert) => fired.push(alert),
    now: () => NOW,
  });
  await engine.load();
  return { engine, fired };
}

async function created(
  engine: AlertEngine,
  direction: "above" | "below",
  price: number,
  symbol = "AAPL",
) {
  const result = await engine.create({ symbol, direction, price });
  if (!result.ok) throw new Error(result.message);
  return result.alert;
}

describe("AlertEngine", () => {
  it("fires an above alert when a trade touches the target exactly, and only once", async () => {
    await addToWatchlist(db, "AAPL", 30);
    const { engine, fired } = await startedEngine();
    const alert = await created(engine, "above", 200);

    engine.onPrice("AAPL", 199.99, NOW);
    await engine.settled();
    expect(fired).toEqual([]);

    engine.onPrice("AAPL", 200, NOW + 1000);
    engine.onPrice("AAPL", 201, NOW + 2000);
    await engine.settled();
    engine.onPrice("AAPL", 202, NOW + 3000);
    await engine.settled();

    expect(fired).toEqual([
      {
        id: alert.id,
        symbol: "AAPL",
        direction: "above",
        price: 200,
        triggerPrice: 200,
        triggeredAt: NOW + 1000,
      },
    ]);
    expect(await engine.list()).toEqual([
      expect.objectContaining({ id: alert.id, active: false, triggerPrice: 200 }),
    ]);
  });

  it("fires a below alert at or under the target, never above it", async () => {
    await addToWatchlist(db, "AAPL", 30);
    const { engine, fired } = await startedEngine();
    await created(engine, "below", 150);

    engine.onPrice("AAPL", 150.01, NOW);
    engine.onPrice("AAPL", 400, NOW);
    await engine.settled();
    expect(fired).toEqual([]);

    engine.onPrice("AAPL", 149.5, NOW + 1000);
    await engine.settled();
    expect(fired.map((alert) => alert.triggerPrice)).toEqual([149.5]);
  });

  it("only checks trades for the alert's own symbol", async () => {
    await addToWatchlist(db, "AAPL", 30);
    await addToWatchlist(db, "MSFT", 30);
    const { engine, fired } = await startedEngine();
    await created(engine, "above", 200, "AAPL");

    engine.onPrice("MSFT", 500, NOW);
    await engine.settled();

    expect(fired).toEqual([]);
  });

  it("never fires a deleted alert", async () => {
    await addToWatchlist(db, "AAPL", 30);
    const { engine, fired } = await startedEngine();
    const alert = await created(engine, "above", 200);

    expect(await engine.delete(alert.id)).toBe(true);
    engine.onPrice("AAPL", 250, NOW);
    await engine.settled();

    expect(fired).toEqual([]);
    expect(await engine.delete(alert.id)).toBe(false);
  });

  it("refuses alerts for symbols that aren't on the watchlist", async () => {
    const { engine } = await startedEngine();

    const result = await engine.create({ symbol: "MSFT", direction: "above", price: 1 });

    expect(result).toMatchObject({ ok: false, code: "not_watched" });
    expect(await engine.list()).toEqual([]);
  });

  it("keeps alerts across a restart and fires them once, even with an old engine still running", async () => {
    await addToWatchlist(db, "AAPL", 30);
    const before = await startedEngine();
    await created(before.engine, "below", 100);

    const after = await startedEngine();
    after.engine.onPrice("AAPL", 99, NOW);
    before.engine.onPrice("AAPL", 98, NOW);
    await Promise.all([after.engine.settled(), before.engine.settled()]);

    expect([...before.fired, ...after.fired]).toHaveLength(1);

    const restarted = await startedEngine();
    restarted.engine.onPrice("AAPL", 90, NOW + 1000);
    await restarted.engine.settled();
    expect(restarted.fired).toEqual([]);
  });
});
