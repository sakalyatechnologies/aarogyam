/** Warm, plain wording for a stock projection, shared by the alerts strip, the analytics table and Today. */

const plural = (n: number, one: string, many: string) => `${String(n)} ${n === 1 ? one : many}`;

/** "Runs out in about 6 days", or "Below reorder level" when there is not enough history to project. */
export function coverText(daysCover: number | null | undefined): string {
  if (daysCover == null) return "Below reorder level";
  if (daysCover <= 0) return "Runs out today";
  return `Runs out in about ${plural(daysCover, "day", "days")}`;
}

/** "Order about 120 pieces", or nothing when no quantity is suggested. */
export function reorderText(quantity: number | null | undefined, unit: string): string | undefined {
  return quantity == null || quantity <= 0 ? undefined : `Suggested reorder: ${String(quantity)} ${unit}`;
}

/** The copy shown when nothing is running low. */
export const HEALTHY = "Stock looks healthy — nothing running low 🎉";
