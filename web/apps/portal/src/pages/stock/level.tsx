import type { StockLevel } from "@aarogyam/api-client";
import { Pill } from "@sakalya/ui";

type Tone = "success" | "warning" | "danger" | "info";

const STATUS: Readonly<Record<string, { label: string; tone: Tone }>> = {
  ok: { label: "OK", tone: "success" },
  low: { label: "LOW", tone: "warning" },
  critical: { label: "CRITICAL", tone: "danger" },
  expiring: { label: "EXPIRING", tone: "info" },
};

/** The status tag: green OK, amber LOW, red CRITICAL, blue EXPIRING. */
export function StatusTag({ status }: { status: string }) {
  const known = STATUS[status] ?? { label: status.toUpperCase(), tone: "warning" as const };
  return <Pill tone={known.tone}>{known.label}</Pill>;
}

/** How full the shelf is against the reorder level, 0 to 100. */
export function levelPercent(level: Pick<StockLevel, "on_hand"> & { item: { reorder_level: number } }): number {
  const reorder = level.item.reorder_level;
  return reorder <= 0 ? 100 : Math.min(100, Math.round((level.on_hand / reorder) * 100));
}

/** The level meter: a thin bar that turns red below a quarter of the reorder level. */
export function LevelBar({ name, percent }: { name: string; percent: number }) {
  const low = percent < 25;
  return (
    <div
      role="progressbar"
      aria-label={`${name} stock level`}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      aria-valuetext={`${String(percent)}% of the reorder level`}
      className="mt-2 h-2 w-full min-w-[120px] overflow-hidden rounded-full bg-surface-muted"
    >
      <div className={low ? "h-full rounded-full bg-danger" : "h-full rounded-full bg-primary"} style={{ width: `${String(percent)}%` }} />
    </div>
  );
}

/** `restorative` → `Restorative`. */
export function categoryLabel(category: string | null | undefined): string {
  if (category == null || category === "") return "—";
  return `${category.charAt(0).toUpperCase()}${category.slice(1).replaceAll("_", " ")}`;
}
