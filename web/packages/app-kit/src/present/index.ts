// @aarogyam/app-kit/present: Show patient's shared model and blocks (present-studio-design §5). The
// portal and the phone bundle share it. Styles are lazy chunks: `loadPaintedStyle()`.
// Import "@aarogyam/app-kit/present.css" next to it (the shell, blocks and painted style). "How to brush" is
// `@aarogyam/app-kit/present/brushing-panel`, loaded lazily; HoldToExit needs "@aarogyam/app-kit/hold-to-exit.css".
export { EXIT_HOLD_MS, HoldToExit } from "./hold-to-exit.js";
export {
  presentFacts, screenOrder, dottedTeeth,
  type PresentModel, type FactItem, type FactKind, type ToothFacts, type Orientation, type Eruption, type Angulation, type Origin,
} from "./model.js";
export { PRESENT_STYLES, SHIPPED_STYLES, DEFAULT_STYLE, isShipped, type PresentStyleId, type PresentStyleInfo } from "./styles.js";
export {
  RecordBadge, IllustrationBadge, FactList, ProvenanceFooter, TextFallback, StyleSwitcher, StyleBoundary, useChunk, dotsOf, toneOf,
  type SwitcherOption, type DotTone,
} from "./blocks.js";
export type { ShadeKnob } from "./painter.js";
export type { PaintedProps, PaintedView } from "./painted.js";
export type { OpenWideProps, WideArt } from "./open-wide.js";
export { CompareSlider, sharedBox, type CompareSliderProps } from "./compare-slider.js";
export { ToothSheet, sheetContent, type ToothSheetProps, type SheetContent, type StateSpec } from "./tooth-sheet.js";
export { XrayStyle, XrayView, XrayEdges, XRAY_EDGES, type XrayProps } from "./xray.js";
export { PaintedSlot } from "./painted-slot.js";
export { StudioProvider, SituationOptions, ToothOptions, useStudio, situationsOf, visitsWords, finishWords } from "./options.js";
export { StorySlot } from "./story-slot.js";
export type { StoryProps, StoryCard } from "./story.js";

/** The painted style's chunk (painter, front atlas and Open wide). Show patient prefetches it. */
export const loadPaintedStyle = () => import("./painted.js").then((m) => m.paintedStyle);
/** Open wide, the shared "biting side" block, for any style (§5.3). The painted chunk already holds it. */
export const loadOpenWide = () => import("./open-wide.js").then((m) => m.OpenWide);
