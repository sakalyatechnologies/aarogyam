// Data shapes of the mouth art kit. Every picture is SVG path strings plus gradient specs, so the
// same `d` renders as `<path d>` and as `new Path2D(d)` (design §1.12 m3).

/** [x, y, width, height] in the view's units (100x200 per tooth view, 6.2 units = 1 mm). */
export type Box = [number, number, number, number];
/** SVG/canvas matrix [a, b, c, d, e, f]. */
export type Matrix = [number, number, number, number, number, number];
/** [offset, paint name, opacity?]. */
export type Stop = [number, string] | [number, string, number];

export interface LinearGradient {
  id: string;
  t: "l";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  s: Stop[];
}
export interface RadialGradient {
  id: string;
  t: "r";
  cx: number;
  cy: number;
  r: number;
  /** Vertical scale around (cx, cy). */
  sy?: number;
  s: Stop[];
}
export type GradientSpec = LinearGradient | RadialGradient;

/**
 * One drawn path. `d` is a path, "@slot" (tooth geometry), "#shape" (shared unit shape) or "@tex".
 * Paints: "g:<gradient>", a shade token, a colour name or "#hex". `at` maps a 100x100 unit box onto
 * an anchor; `mv` moves by [dx mm, dy mm, degrees] around the crown; `above` places an added layer.
 */
export interface ArtLayer {
  n: string;
  d: string;
  f?: string;
  s?: string;
  w?: number;
  o?: number;
  c?: string;
  above?: string;
  at?: string;
  dash?: number[];
  mv?: [number, number, number];
  tr?: Matrix;
  rule?: "evenodd";
}

export interface ArtView {
  box: Box;
  g: GradientSpec[];
  clips: Record<string, string>;
  layers: ArtLayer[];
  slots?: Record<string, string>;
  anchors?: Record<string, Box | Box[]>;
  mat?: GradientSpec[];
}

export type ViewName = "top" | "front" | "section";

export const TOOTH_TYPES = [
  "u1", "u2", "u3", "u4", "u5", "u6", "u7", "u8",
  "l1", "l2", "l3", "l4", "l5", "l6", "l7", "l8",
  "pu1", "pu2", "pu3", "pu4", "pu5",
  "pl1", "pl2", "pl3", "pl4", "pl5",
] as const;
export type ToothType = (typeof TOOTH_TYPES)[number];

export interface ToothArt {
  type: string;
  label: string;
  arch: "upper" | "lower";
  primary: boolean;
  views: Record<ViewName, ArtView>;
  /** Geometry shared by the front and section views. */
  geo: Record<string, string>;
  anchors: Record<string, Box | Box[]>;
  /** Material gradients for the front and section views. */
  mat: GradientSpec[];
}

export interface ShapeSet {
  d: Record<string, string>;
  g: GradientSpec[];
}

export interface StageScene {
  view: ViewName;
  /** Extra room in mm beyond the crown (e.g. for an instrument). */
  grow?: number;
  hide?: string[];
  add: ArtLayer[];
  mode?: "eruption";
}

export interface EruptionBackdrop {
  box: Box;
  g: GradientSpec[];
  layers: ArtLayer[];
  clips: Record<string, string>;
  neighborX: number;
  drop: Record<string, number>;
  angle: Record<string, number>;
}

export interface StageSet {
  steps: string[];
  scenes: Record<string, StageScene>;
  backdrop?: EruptionBackdrop;
}

export interface BrushingRow {
  /** Crown outlines of the patient's right side, by FDI number; the left side is mirrored. */
  teeth: Record<string, string>;
  highlights: string;
  shades: string;
  fill: string;
  gum: string;
  gumFill: string;
}

export interface BrushingArt {
  band: string;
  box: Box;
  g: GradientSpec[];
  opening: string;
  /** Everything outside the opening (for drawing the brush handle over the lips). */
  outside: string;
  back: ArtLayer[];
  upper: BrushingRow;
  lower: BrushingRow;
  front: ArtLayer[];
  /** Brush-local coordinates: head centre at the origin, bristles toward -y, handle toward +x. */
  brush: ArtLayer[];
  paste: ArtLayer[];
  hand: ArtLayer[];
  floss: ArtLayer[];
  brushScale: number;
}

// ---------- resolved scenes (what renderers draw) ----------

export type ResolvedPaint = { color: string } | { gradient: string };

export interface ResolvedGradient {
  id: string;
  spec: GradientSpec;
  /** CSS colours, one per stop. */
  colors: string[];
}

export interface SceneNode {
  d: string;
  fill?: ResolvedPaint;
  stroke?: ResolvedPaint;
  width?: number;
  opacity?: number;
  dash?: number[];
  rule?: "evenodd";
  /** Clip id; the clip lives in the node's group space. */
  clip?: string;
  /** Group transform (tooth placement), applied before the clip. */
  group?: Matrix;
  /** Layer transform, applied inside the clip. */
  m?: Matrix;
  /** Layer name, kept only for layers a caller asked to mark (callout anchors). */
  n?: string;
}

export interface SceneLabel {
  text: string;
  x: number;
  y: number;
  anchor?: "start" | "middle" | "end";
}

export interface Scene {
  /** viewBox in final (unflipped) coordinates. */
  box: Box;
  /** Whole-scene transform (upper-arch flip, left-side mirror). */
  outer?: Matrix;
  gradients: ResolvedGradient[];
  clips: Record<string, { d: string; group?: Matrix }>;
  nodes: SceneNode[];
  /** Text in final coordinates (never flipped). */
  labels: SceneLabel[];
  /** "Illustration: … not recorded" notes the caller must show (§1.13). */
  notes: string[];
}
