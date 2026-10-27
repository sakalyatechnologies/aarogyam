/** The fake's stock rules, the same as the API's (`aarogyam-domain::inventory`): status by reorder level, first-expired-first-out picking. */

import type * as C from "../contract.js";
import type { FakeInventoryItem, FakeStockBatch } from "./fixtures.js";

/** Days ahead in which a batch counts as about to expire. */
export const EXPIRY_WINDOW_DAYS = 30;
export const MAX_MOVEMENT = 1_000_000;

const DAY = 86_400_000;

/** `date` (`YYYY-MM-DD`) moved by `days`. */
export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
}

/** Whole days from `from` to `to`, both `YYYY-MM-DD`. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);
}

/** Running out beats running low, which beats expiry. */
export function stockStatus(onHand: number, reorderLevel: number, expiring: boolean): C.StockLevel["status"] {
  if (onHand <= 0 || onHand * 5 <= reorderLevel) return "critical";
  if (onHand <= reorderLevel) return "low";
  return expiring ? "expiring" : "ok";
}

export function isExpired(expiry: string | null | undefined, today: string): boolean {
  return expiry != null && expiry < today;
}

/** An item's level from its batches. */
export function levelOf(item: FakeInventoryItem, batches: readonly FakeStockBatch[], today: string): C.StockLevel {
  const mine = batches.filter((b) => b.item_id === item.id);
  const onHand = mine.reduce((sum, b) => sum + b.quantity, 0);
  const expiries = mine.flatMap((b) => (b.quantity > 0 && b.expiry != null ? [b.expiry] : [])).sort();
  const nextExpiry = expiries[0] ?? null;
  const expiring = nextExpiry !== null && daysBetween(today, nextExpiry) <= EXPIRY_WINDOW_DAYS;
  return {
    item: wireItem(item),
    on_hand: onHand,
    next_expiry: nextExpiry,
    status: stockStatus(onHand, item.reorder_level, expiring),
    suggested_order: item.max_level != null && item.max_level > onHand ? item.max_level - onHand : null,
  };
}

const UNITS: ReadonlySet<string> = new Set(["piece", "ml", "g", "box", "pack"]);

/** Whether `unit` is one the clinic stocks in. */
export function isStockUnit(unit: string): unit is FakeInventoryItem["unit"] {
  return UNITS.has(unit);
}

export function wireItem(item: FakeInventoryItem): C.InventoryItem {
  return {
    id: item.id,
    name: item.name,
    category: item.category ?? null,
    unit: item.unit,
    reorder_level: item.reorder_level,
    max_level: item.max_level ?? null,
    active: item.active,
  };
}

const URGENCY: Readonly<Record<string, number>> = { critical: 0, low: 1, expiring: 2, ok: 3 };

export function byUrgency(levels: readonly C.StockLevel[]): C.StockLevel[] {
  return [...levels].sort((a, b) => (URGENCY[a.status] ?? 9) - (URGENCY[b.status] ?? 9) || a.item.name.localeCompare(b.item.name));
}

/** Takes `needed` units earliest expiry first (none last, then oldest delivery), skipping expired batches unless `includeExpired`. `null` when the batches hold less. */
export function pickFefo(
  batches: readonly FakeStockBatch[],
  needed: number,
  today: string,
  includeExpired = false,
): { batch: FakeStockBatch; take: number }[] | null {
  const usable = batches
    .filter((b) => b.quantity > 0 && (includeExpired || !isExpired(b.expiry, today)))
    .sort((a, b) => {
      if ((a.expiry == null) !== (b.expiry == null)) return a.expiry == null ? 1 : -1;
      return (a.expiry ?? "").localeCompare(b.expiry ?? "") || a.received_on.localeCompare(b.received_on);
    });
  const picks: { batch: FakeStockBatch; take: number }[] = [];
  let left = needed;
  for (const batch of usable) {
    if (left === 0) break;
    const take = Math.min(left, batch.quantity);
    picks.push({ batch, take });
    left -= take;
  }
  return left > 0 ? null : picks;
}

/** Days of use history a projection needs, and the most it averages over (`aarogyam-domain::inventory`). */
const MIN_PROJECTION_DAYS = 7;
const MAX_PROJECTION_DAYS = 14;
const ALERT_MARGIN_DAYS = 3;
const REORDER_COVER_DAYS = 14;

export interface Projection {
  onHand: number;
  dailyUsage: number | null;
  daysCover: number | null;
  runsOutOn: string | null;
  shouldAlert: boolean;
  reason: "low" | "projected" | null;
  suggestedReorderQty: number | null;
}

/** The same projection as the API's `project()`: whole-number maths over the last 14 complete clinic days. `dailyUse` is units used per clinic day. */
export function projectStock(input: {
  today: string;
  reorderLevel: number;
  leadTimeDays: number;
  batches: readonly { expiry: string | null; quantity: number }[];
  dailyUse: ReadonlyMap<string, number>;
}): Projection {
  const { today } = input;
  const live = (expiry: string | null): boolean => !isExpired(expiry, today);
  const onHand = input.batches.filter((b) => b.quantity > 0 && live(b.expiry)).reduce((sum, b) => sum + b.quantity, 0);
  const status = stockStatus(onHand, input.reorderLevel, false);
  const reasonLow = status === "low" || status === "critical" ? ("low" as const) : null;
  const none: Projection = {
    onHand,
    dailyUsage: null,
    daysCover: null,
    runsOutOn: null,
    shouldAlert: reasonLow !== null,
    reason: reasonLow,
    suggestedReorderQty: null,
  };
  const useDays = [...input.dailyUse.entries()].filter(([, q]) => q > 0).map(([day]) => day).filter((day) => day <= today);
  const first = useDays.sort()[0];
  if (first === undefined) return none;
  const window = Math.min(MAX_PROJECTION_DAYS, daysBetween(first, today));
  if (window < MIN_PROJECTION_DAYS) return none;
  const start = addDays(today, -window);
  const inWindow = [...input.dailyUse.entries()].filter(([day, q]) => day >= start && day < today && q > 0);
  const used = inWindow.reduce((sum, [, q]) => sum + q, 0);
  if (inWindow.length < 2 || used <= 0) return none;

  const cover = (usable: number): number => Math.floor((usable * window) / used);
  let usable = onHand;
  let daysCover = cover(usable);
  for (let pass = 0; pass <= input.batches.length; pass += 1) {
    const runsOut = addDays(today, Math.min(daysCover, 36_500));
    const kept = input.batches
      .filter((b) => b.quantity > 0 && live(b.expiry) && (b.expiry === null || b.expiry >= runsOut))
      .reduce((sum, b) => sum + b.quantity, 0);
    if (kept === usable) break;
    usable = kept;
    daysCover = cover(usable);
  }
  const projected = daysCover <= input.leadTimeDays + ALERT_MARGIN_DAYS;
  const reason = reasonLow ?? (projected ? ("projected" as const) : null);
  const target = Math.ceil((used * (input.leadTimeDays + REORDER_COVER_DAYS)) / window);
  return {
    onHand,
    dailyUsage: used / window,
    daysCover,
    runsOutOn: addDays(today, Math.min(daysCover, 36_500)),
    shouldAlert: reason !== null,
    reason,
    suggestedReorderQty: Math.max(0, target - usable),
  };
}
