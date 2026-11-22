// @aarogyam/app-kit/present: Show patient's shared model and blocks (present-studio-design §5). The
// portal and the phone bundle share it. Styles are lazy chunks: `loadPaintedStyle()`.
// Import "@aarogyam/app-kit/present.css" next to it.
export {
  presentFacts, screenOrder, dottedTeeth,
  type PresentModel, type FactItem, type FactKind, type ToothFacts, type Orientation, type Eruption, type Angulation, type Origin,
} from "./model.js";
export { PRESENT_STYLES, SHIPPED_STYLES, DEFAULT_STYLE, isShipped, type PresentStyleId, type PresentStyleInfo } from "./styles.js";
export {
  RecordBadge, IllustrationBadge, FactList, ProvenanceFooter, TextFallback, StyleSwitcher, useChunk, dotsOf, toneOf,
  type SwitcherOption, type DotTone,
} from "./blocks.js";
export type { ShadeKnob } from "./painter.js";
export type { PaintedProps } from "./painted.js";

/** The painted style's chunk (painter + front atlas). Show patient prefetches it. */
export const loadPaintedStyle = () => import("./painted.js").then((m) => m.paintedStyle);
