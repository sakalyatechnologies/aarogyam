// The example arch for "Straighter teeth" (present-studio-design §8.5, slice 3c): an invented adult set of 28
// teeth painted with the painted map's own painter, with the front six of each arch crowded at progress 0 and
// straight at 1, and braces, aligners or a retainer drawn over it. Never this patient's teeth. Units are
// millimetres, like painter.ts. Framework-free; the layout is jsdom-safe (only paintExampleArch needs a canvas).
import { FRONT_ATLAS } from "../mouth-art/gen/front-atlas.js";
import { toothTypeOf } from "../mouth-art/loaders.js";
import type { PresentModel, ToothFacts } from "./model.js";
import { DEFAULT_SHADE, onCrown, paintSmile, smileScene, type PaintTooth, type SmileScene } from "./painter.js";

export type Appliance = "braces" | "aligners" | "retainer" | "none";

/** How a front tooth sits at progress 0: slid sideways into its neighbour (mm, so crowns overlap but never open a gap), a hair up or down (at most .5 mm), turned (the painter's shading turn, 0..1), tipped (radians), narrower and pushed behind. */
interface Crowd { dx: number; dy: number; turn: number; tilt?: number; narrow?: number; back?: number }
// keyed `arch + index + side` (side -1 = the patient's right). Fixed numbers: the same picture every time.
// Along each arch the slides step by at most .3 mm towards a gap and by more towards an overlap.
const CROWD: Readonly<Record<string, Crowd>> = {
  "u3-1": { dx: -.4, dy: .2, turn: .5 }, "u2-1": { dx: -.9, dy: -.1, turn: .7, narrow: .25, back: 7 }, "u1-1": { dx: -.9, dy: .3, turn: .35, tilt: -.05 },
  "u11": { dx: -.7, dy: -.2, turn: .4 }, "u21": { dx: -.45, dy: .3, turn: .3 }, "u31": { dx: -.15, dy: -.2, turn: .35 },
  "l3-1": { dx: .2, dy: -.1, turn: .3 }, "l2-1": { dx: -.35, dy: .3, turn: .5 }, "l1-1": { dx: -.7, dy: .1, turn: .55, tilt: .14 },
  "l11": { dx: -.55, dy: -.3, turn: .6, tilt: -.2 }, "l21": { dx: -.25, dy: .2, turn: .4 }, "l31": { dx: .05, dy: -.1, turn: .3 },
};
const crowdKey = (t: PaintTooth) => `${t.arch}${String(t.n)}${t.side === 1 ? "1" : "-1"}`;

/** The invented mouth: every adult position 1..7 in all four quadrants, recorded sound, nothing faded or marked. */
export function exampleModel(): PresentModel {
  const teeth: ToothFacts[] = [];
  for (const q of [1, 2, 4, 3] as const) {
    for (let i = 1; i <= 7; i++) {
      const fdi = q * 10 + i;
      const type = toothTypeOf(fdi);
      if (type === undefined) continue;
      teeth.push({ tooth: fdi, type, quadrant: q, index: i, shown: "sound", missing: false, draw: [], facts: [] });
    }
  }
  return { dentition: "adult", orientation_default: "mirror", facts: [], teeth };
}

/** The scene at a progress (0 crowded, 1 straight). Pure: the same progress gives the same scene. */
export function exampleScene(progress: number): SmileScene {
  const p = Math.min(1, Math.max(0, Number.isFinite(progress) ? progress : 0));
  const left = 1 - p;
  const scene = smileScene(exampleModel(), FRONT_ATLAS, "mirror");
  for (const t of scene.teeth) {
    const c = CROWD[crowdKey(t)];
    if (c === undefined || left === 0) continue;
    const cut = (c.narrow ?? 0) * left;
    t.xl += c.dx * left + cut; t.xr += c.dx * left - cut;
    t.z += (c.back ?? 0) * left;
    if (c.tilt !== undefined) t.tilt = c.tilt * left;
    t.top += c.dy * left; t.bot += c.dy * left; t.cej += c.dy * left;
    t.turn = Math.min(1, t.turn + c.turn * left);
  }
  return scene;
}

/** The front-face teeth a bracket sits on: first molar to first molar (positions 1..6) on both arches. */
export const frontFace = (scene: SmileScene): PaintTooth[] => scene.teeth.filter((t) => !t.hidden && !t.missing && t.n <= 6);

export interface Bracket { fdi: number; arch: "u" | "l"; x: number; y: number; size: number }

/** The middle of the crown that shows: the gum hides the top quarter of an upper crown and the bottom quarter of a lower one. */
const visibleMid = (t: PaintTooth): number => t.top + (t.bot - t.top) * (t.arch === "u" ? .62 : .38);

/** One bracket per front-face tooth, centred on the crown, in picture millimetres (before any mirroring). */
export function bracketsOf(scene: SmileScene): Bracket[] {
  return frontFace(scene).map((t) => ({ fdi: t.fdi, arch: t.arch, x: (t.xl + t.xr) / 2, y: visibleMid(t), size: Math.min(1.85, (t.xr - t.xl) * .34) }));
}
/** The wire through the brackets of one arch, left to right. */
export const wireOf = (brackets: readonly Bracket[], arch: "u" | "l"): [number, number][] =>
  brackets.filter((b) => b.arch === arch).sort((a, b) => a.x - b.x).map((b): [number, number] => [b.x, b.y]);

export interface ExampleArchOptions { progress: number; appliance: Appliance; theme: "light" | "dark" }

function polyline(ctx: CanvasRenderingContext2D, pts: readonly [number, number][]) {
  ctx.beginPath();
  pts.forEach(([x, y], i) => { if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
  ctx.stroke();
}

/** Paints the example arch, then the appliance over it. Returns the time it took in ms (0 without a canvas). */
export function paintExampleArch(canvas: HTMLCanvasElement, o: ExampleArchOptions): number {
  const scene = exampleScene(o.progress);
  const ms = paintSmile(canvas, scene, FRONT_ATLAS, { shade: DEFAULT_SHADE, theme: o.theme });
  const ctx = canvas.getContext("2d");
  if (ctx === null || o.appliance === "none") return ms;
  const k = canvas.width / scene.box[2];
  const base = new DOMMatrix().scale(k, k).translate(-scene.box[0], -scene.box[1]).scale(scene.mirror ? -1 : 1, 1);
  ctx.setTransform(base);
  ctx.lineJoin = "round"; ctx.lineCap = "round";
  const metal = o.theme === "dark" ? { fill: "#c9ced6", edge: "#7d8590", wire: "#aeb5bf" } : { fill: "#c4cad2", edge: "#6b727b", wire: "#8a919b" };
  if (o.appliance === "braces") {
    const brackets = bracketsOf(scene);
    ctx.strokeStyle = "rgba(20,24,30,.35)"; ctx.lineWidth = .62;
    for (const a of ["u", "l"] as const) polyline(ctx, wireOf(brackets, a));
    ctx.strokeStyle = metal.wire; ctx.lineWidth = .36;
    for (const a of ["u", "l"] as const) polyline(ctx, wireOf(brackets, a));
    for (const b of brackets) {
      const r = b.size / 2;
      ctx.beginPath(); ctx.roundRect(b.x - r, b.y - r, b.size, b.size, r * .35);
      ctx.fillStyle = metal.fill; ctx.fill();
      ctx.lineWidth = .16; ctx.strokeStyle = metal.edge; ctx.stroke();
    }
  } else if (o.appliance === "aligners") {
    // each crown's own outline, inflated about .25 mm: a stroke twice that wide straddles the edge
    for (const t of scene.teeth.filter((x) => !x.hidden && !x.missing)) {
      onCrown(ctx, base, t, FRONT_ATLAS, (outline, unit) => {
        ctx.fillStyle = "rgba(255,255,255,.18)"; ctx.fill(outline);
        ctx.lineWidth = .5 * unit; ctx.strokeStyle = "rgba(255,255,255,.5)"; ctx.stroke(outline);
      });
    }
  } else {
    // a retainer: a thin wire behind the lower front six
    const pts = scene.teeth.filter((t) => t.arch === "l" && t.n <= 3).sort((a, b) => a.xl - b.xl)
      .map((t): [number, number] => [(t.xl + t.xr) / 2, t.top + (t.bot - t.top) * .62]);
    ctx.strokeStyle = metal.wire; ctx.lineWidth = .24;
    polyline(ctx, pts);
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  return ms;
}
