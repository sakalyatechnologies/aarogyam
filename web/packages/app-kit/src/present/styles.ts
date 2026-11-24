// The five Show patient styles (present-studio-design §4), in the switcher's order: the lay-patient
// ranking from review round 1. A style ships when its lazy module exists; the others are listed as
// "Coming soon" so the doctor sees what is on the way.
export type PresentStyleId = "story" | "painted" | "smile3d" | "face";

export interface PresentStyleInfo {
  id: PresentStyleId;
  label: string;
  /** Beta per F11 (3D smile, face to tooth). */
  beta: boolean;
}

export const PRESENT_STYLES: readonly PresentStyleInfo[] = [
  { id: "story", label: "Your visit", beta: false },
  { id: "painted", label: "Map + list", beta: false },
  { id: "smile3d", label: "3D smile", beta: true },
  { id: "face", label: "Face to tooth", beta: true },
];

/** Styles built so far (story cards 1d, painted 1a, own X-ray 1e, 3D smile 3a, face 3b). */
export const SHIPPED_STYLES: ReadonlySet<PresentStyleId> = new Set<PresentStyleId>(["story", "painted", "smile3d", "face"]);

/** The style Show patient opens on until "Make default" (slice 1f). */
export const DEFAULT_STYLE: PresentStyleId = "story";

export const isShipped = (id: PresentStyleId): boolean => SHIPPED_STYLES.has(id);

/**
 * A saved or app-sent style id, as one we still draw. "xray" (Own X-ray, now a Story card) opens Your visit;
 * anything unknown is undefined, so the caller falls back to DEFAULT_STYLE.
 */
export function normalizeStyle(v: unknown): PresentStyleId | undefined {
  if (v === "xray") return "story";
  return PRESENT_STYLES.find((s) => s.id === v)?.id;
}
