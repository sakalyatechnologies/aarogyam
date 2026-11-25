// The five Show patient styles (present-studio-design §4), in the switcher's order: the lay-patient
// ranking from review round 1. A style ships when its lazy module exists; the others are listed as
// "Coming soon" so the doctor sees what is on the way.
export type PresentStyleId = "story" | "painted";

export interface PresentStyleInfo {
  id: PresentStyleId;
  label: string;
  /** Reserved for a future beta look; none today. */
  beta: boolean;
}

export const PRESENT_STYLES: readonly PresentStyleInfo[] = [
  { id: "story", label: "Your visit", beta: false },
  { id: "painted", label: "Map + list", beta: false },
];

/** Styles built so far (story cards 1d, painted 1a, own X-ray 1e). */
export const SHIPPED_STYLES: ReadonlySet<PresentStyleId> = new Set<PresentStyleId>(["story", "painted"]);

/** The style Show patient opens on until "Make default" (slice 1f). */
export const DEFAULT_STYLE: PresentStyleId = "story";

export const isShipped = (id: PresentStyleId): boolean => SHIPPED_STYLES.has(id);

/**
 * A saved or app-sent style id, as one we still draw. "xray" (Own X-ray, now a Story card) opens Your visit;
 * anything unknown is undefined, so the caller falls back to DEFAULT_STYLE.
 */
export function normalizeStyle(v: unknown): PresentStyleId | undefined {
  // "xray" is a Story card now; "smile3d" and "face" (the removed beta looks) may still be saved or sent by an old phone
  if (v === "xray" || v === "smile3d" || v === "face") return "story";
  return PRESENT_STYLES.find((s) => s.id === v)?.id;
}
