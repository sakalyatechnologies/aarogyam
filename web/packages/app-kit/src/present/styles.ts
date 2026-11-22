// The five Show patient styles (present-studio-design §4), in the switcher's order: the lay-patient
// ranking from review round 1. A style ships when its lazy module exists; the others are listed as
// "Coming soon" so the doctor sees what is on the way.
export type PresentStyleId = "story" | "painted" | "xray" | "smile3d" | "face";

export interface PresentStyleInfo {
  id: PresentStyleId;
  label: string;
  /** Beta per F11 (3D smile, face to tooth). */
  beta: boolean;
}

export const PRESENT_STYLES: readonly PresentStyleInfo[] = [
  { id: "story", label: "Story cards", beta: false },
  { id: "painted", label: "Painted smile", beta: false },
  { id: "xray", label: "Own X-ray", beta: false },
  { id: "smile3d", label: "3D smile", beta: true },
  { id: "face", label: "Face to tooth", beta: true },
];

/** Styles built so far (story cards from slice 1d, painted from 1a). */
export const SHIPPED_STYLES: ReadonlySet<PresentStyleId> = new Set<PresentStyleId>(["story", "painted", "xray"]);

/** The style Show patient opens on until "Make default" (slice 1f). */
export const DEFAULT_STYLE: PresentStyleId = "story";

export const isShipped = (id: PresentStyleId): boolean => SHIPPED_STYLES.has(id);
