import { and, desc, eq } from "drizzle-orm";

import type { Database } from "../client";
import { alerts } from "../schema";

export type Alert = typeof alerts.$inferSelect;
export type AlertDirection = Alert["direction"];

export async function createAlert(
  db: Database,
  input: { symbol: string; direction: AlertDirection; price: number },
): Promise<Alert> {
  const [alert] = await db.insert(alerts).values(input).returning();
  if (!alert) throw new Error("Alert insert returned no row");
  return alert;
}

export function listAlerts(db: Database): Promise<Alert[]> {
  return db.select().from(alerts).orderBy(desc(alerts.createdAt));
}

export function listActiveAlerts(db: Database): Promise<Alert[]> {
  return db.select().from(alerts).where(eq(alerts.active, true));
}

export async function deleteAlert(db: Database, id: string): Promise<boolean> {
  const removed = await db.delete(alerts).where(eq(alerts.id, id)).returning({ id: alerts.id });
  return removed.length > 0;
}

/**
 * Atomically deactivates an active alert and records the trigger. Returns the updated alert, or
 * `null` if it was already triggered or deleted. This conditional update is what makes an alert
 * fire exactly once, even across reconnects or concurrent evaluations.
 */
export async function markAlertTriggered(
  db: Database,
  id: string,
  triggerPrice: number,
  triggeredAt: Date,
): Promise<Alert | null> {
  const [alert] = await db
    .update(alerts)
    .set({ active: false, triggeredAt, triggerPrice })
    .where(and(eq(alerts.id, id), eq(alerts.active, true)))
    .returning();
  return alert ?? null;
}
