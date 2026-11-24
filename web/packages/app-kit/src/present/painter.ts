// The painted map (present-studio-design §6.2): the front of both arches painted on a canvas from the
// kit's front crown outlines (FRONT_ATLAS), on one continuous gum, inside a neutral grey frame with no
// lips or skin. Ported from the round-1 prototype (present-options/src/smile-paint.js) with the review
// fixes: front art only (no biting-surface strips), tight contacts, a gap with gum where a tooth is
// recorded missing, the wisdom tooth drawn only from its recorded eruption and angle, and dots that
// sit on the recorded tooth. Units are millimetres; photo coordinates put the patient's right at x < 0
// and mirror (the default) flips the picture. Framework-free; jsdom-safe (layout only, no canvas).
import { TOOTH_WIDTH_MM } from "../mouth-art/arch.js";
import type { Box, FrontAtlas, FrontCrown, ToothType } from "../mouth-art/types.js";
import type { Orientation, PresentModel, ToothFacts } from "./model.js";

/** The tooth colour: 0 is the lightest, 100 the deepest (the shade code is never shown). */
export type Shade = number;
/** Where the doctor's slider starts when nothing is saved: the old "natural". */
export const DEFAULT_SHADE: Shade = 33;
type Ramp = readonly [string, string, string];
/** The four ramps of the earlier knob, now the stops of the slider at 0, 33, 67 and 100. */
type Stop = { at: number; swatch: string; ramp: Ramp };
const STOPS: readonly [Stop, Stop, Stop, Stop] = [
  { at: 0, swatch: "#f3ede0", ramp: ["#f4efe4", "#ebe1cc", "#dccaa8"] },
  { at: 33, swatch: "#efe6d2", ramp: ["#f0e8d7", "#e6d7ba", "#d4bc92"] },
  { at: 67, swatch: "#ebdfc6", ramp: ["#ece1ca", "#dfcca7", "#cbad7d"] },
  { at: 100, swatch: "#e5d6b8", ramp: ["#e6d8bd", "#d6c096", "#c0a06e"] },
];
/** The two stops around `n` (clamped to 0..100) and how far between them. */
function between(n: number): { a: Stop; b: Stop; t: number } {
  const v = Math.min(100, Math.max(0, Number.isFinite(n) ? n : DEFAULT_SHADE));
  const [s0, s1, s2, s3] = STOPS;
  const [a, b] = v <= s1.at ? [s0, s1] : v <= s2.at ? [s1, s2] : [s2, s3];
  return { a, b, t: (v - a.at) / (b.at - a.at) };
}
/** The three tooth colours for a shade, interpolated between the stops. */
export function shadeRamp(n: Shade): Ramp {
  const { a, b, t } = between(n);
  return [mix(a.ramp[0], b.ramp[0], t), mix(a.ramp[1], b.ramp[1], t), mix(a.ramp[2], b.ramp[2], t)];
}
/** One swatch colour for the slider's track and thumb. */
export function shadeSwatch(n: Shade): string {
  const { a, b, t } = between(n);
  return mix(a.swatch, b.swatch, t);
}
/** The slider's track: the stop swatches, light to deep. */
export const SHADE_TRACK = `linear-gradient(to right, ${STOPS.map((s) => `${s.swatch} ${String(s.at)}%`).join(", ")})`;
const MILK: Ramp = ["#f7f5ef", "#eeeadf", "#dcd4c2"];
/** Nothing recorded at the position: a quiet grey tooth, so the recorded ones stand out. */
const FADED: Ramp = ["#e4e2dd", "#d3d0c9", "#bdb9b0"];

export interface PaintTooth {
  fdi: number;
  type: ToothType;
  arch: "u" | "l";
  /** -1: the patient's right (x < 0 in photo coordinates), 1: the left. */
  side: -1 | 1;
  n: number;
  primary: boolean;
  /** Not drawn at all (an unrecorded wisdom position). */
  hidden: boolean;
  missing: boolean;
  /** Nothing recorded at this position: painted faded. */
  faded: boolean;
  /** Impacted or not through: a dashed outline under the gum, at its recorded angle. */
  ghost: number | undefined;
  /** Partly through: the crown half under the gum. */
  partial: boolean;
  /** A wisdom tooth painted without an eruption record ("Example, not your tooth"). */
  example: boolean;
  xl: number; xr: number; top: number; bot: number; h: number; z: number; sc: number; cej: number; turn: number;
}

export interface SmileScene {
  teeth: PaintTooth[];
  /** x, y, width, height in millimetres (the viewBox, already in screen orientation). */
  box: [number, number, number, number];
  mirror: boolean;
  frame: { Ytop: number; Ybot: number; Xc: number; Yk: number };
}

/* ---------- arch layout (the prototype's, generalised to any recorded positions) ---------- */
const ARCH: readonly [number, number][] = [[0, 0], [4.2, .35], [8.3, 1.5], [12, 3.6], [15, 6.4], [17.3, 9.8], [19, 13.6], [20.6, 17.6], [22.2, 21.8], [23.8, 26], [25.3, 30.3], [26.7, 34.6], [28, 39], [29.2, 43.5], [30.3, 48], [31.3, 52.5], [32.1, 57]];
const SEG: [number, number, number, number, number, number][] = [];
let TOTAL = 0;
for (let i = 1; i < ARCH.length; i++) {
  const [x0, z0] = ARCH[i - 1] ?? [0, 0], [x1, z1] = ARCH[i] ?? [0, 0];
  const l = Math.hypot(x1 - x0, z1 - z0);
  SEG.push([x0, z0, x1, z1, TOTAL, l]);
  TOTAL += l;
}
function at(s: number, k: { sx: number; dz: number }): [number, number] {
  for (const [x0, z0, x1, z1, s0, l] of SEG) if (s <= s0 + l) { const t = (s - s0) / l; return [(x0 + (x1 - x0) * t) * k.sx, z0 + (z1 - z0) * t + k.dz]; }
  const g = SEG[SEG.length - 1] ?? [0, 0, 0, 0, 0, 0];
  return [g[2] * k.sx, g[3] + k.dz];
}
const F = 260; // camera distance in mm
const boxOf = (c: FrontCrown): Box => {
  const b = c.box;
  return isBox(b) ? b : (b[0] ?? [0, 0, 100, 100]);
};
const isBox = (b: Box | Box[]): b is Box => typeof b[0] === "number";
const crownH = (atlas: FrontAtlas, type: ToothType) => { const [, , w, h] = boxOf(atlas[type]); return h * TOOTH_WIDTH_MM[type] / w; };
/** Tilt of a ghost wisdom tooth in radians, towards the front for "mesioangular". */
const GHOST_TILT: Readonly<Record<string, number>> = { vertical: 0.08, mesioangular: 0.62, distoangular: -0.42, horizontal: 1.45 };

export function smileScene(model: PresentModel, atlas: FrontAtlas, orientation: Orientation): SmileScene {
  const teeth: PaintTooth[] = [];
  for (const arch of ["u", "l"] as const) {
    const k = arch === "u" ? { sx: 1, dz: 0 } : { sx: .93, dz: 2.1 };
    for (const side of [-1, 1] as const) {
      const q = arch === "u" ? (side < 0 ? 1 : 2) : (side < 0 ? 4 : 3);
      const row = model.teeth.filter((t) => t.quadrant === q).sort((a, b) => a.index - b.index);
      let s = .1, X = .04;
      for (const t of row) {
        const w = TOOTH_WIDTH_MM[t.type];
        const s0 = s, s1 = s + w;
        s = s1 + .02; // tight contacts: no dark gap between neighbours
        const [xa, za] = at(s0, k), [xb, zb] = at(s1, k);
        const cos = Math.max(.58, Math.abs(xb - xa) / Math.hypot(xb - xa, zb - za));
        const zc = (za + zb) / 2, sc = F / (F + zc);
        const pw = w * cos * sc;
        const P0 = X, P1 = X + pw;
        X += pw - .03;
        const fr = Math.exp(-zc / 9), edge = -0.1 * zc, gap = 3.2 * fr - .55 * (1 - fr);
        const h = crownH(atlas, t.type) * (arch === "l" && t.index <= 3 ? .96 : 1);
        let top: number, bot: number;
        if (arch === "u") { bot = edge * sc; top = bot - h * sc; } else { top = (edge + gap + (t.index === 3 ? .8 : 0)) * sc; bot = top + h * sc - (t.index === 3 ? .8 * sc : 0); }
        const xs = [side * P0, side * P1];
        teeth.push({
          ...paintFlags(t), arch, side, n: t.index,
          xl: Math.min(...xs), xr: Math.max(...xs), top, bot, h: h * sc, z: zc, sc,
          cej: arch === "u" ? top : bot, turn: Math.min(1, Math.max(0, (1 - cos) / .5)),
        });
      }
    }
  }
  const drawn = teeth.filter((t) => !t.hidden);
  const pick = (arch: "u" | "l") => drawn.filter((t) => t.arch === arch);
  const front = (arch: "u" | "l") => pick(arch).sort((a, b) => a.n - b.n)[0];
  const u1 = front("u"), l1 = front("l");
  const outer = Math.max(...drawn.filter((t) => t.ghost === undefined).map((t) => Math.max(Math.abs(t.xl), Math.abs(t.xr))), 20);
  const Ytop = (u1?.cej ?? -10) - 5, Ybot = (l1?.cej ?? 10) + 4.5;
  const Xc = outer + 3;
  const frame = { Ytop, Ybot, Xc, Yk: (Ytop + Ybot) / 2 - .5 };
  // a tight crop: the map fills the width on a phone, with a thin grey frame round the opening
  const padX = 3.5, padY = 3;
  const box: [number, number, number, number] = [-Xc - padX, Ytop - padY, 2 * (Xc + padX), Ybot - Ytop + 2 * padY];
  return { teeth, box, mirror: orientation === "mirror", frame };
}

function paintFlags(t: ToothFacts): Pick<PaintTooth, "fdi" | "type" | "primary" | "hidden" | "missing" | "faded" | "ghost" | "partial" | "example"> {
  const recorded = t.shown !== "not_recorded";
  const wisdom = t.index === 8 && t.type.length === 2;
  const under = t.eruption === "impacted" || t.eruption === "unerupted";
  return {
    fdi: t.tooth, type: t.type, primary: t.type.startsWith("p"),
    hidden: wisdom && !recorded,
    missing: t.missing,
    faded: !recorded,
    ghost: wisdom && under && !t.missing ? (GHOST_TILT[t.angulation ?? "vertical"] ?? 0) : undefined,
    partial: t.eruption === "partial",
    example: wisdom && recorded && !t.missing && t.eruption === undefined,
  };
}

/** Where a tooth's dot sits, in screen (viewBox) millimetres: on the crown, in the gap, or on the hidden wisdom tooth. */
export function dotAt(scene: SmileScene, fdi: number): { x: number; y: number } | undefined {
  const t = scene.teeth.find((x) => x.fdi === fdi);
  if (t === undefined || t.hidden) return undefined;
  const up = t.arch === "u";
  let y = up ? t.top + t.h * .45 : t.bot - t.h * .55;
  // a missing tooth keeps the crown's place: the dot sits in the gap
  if (t.ghost !== undefined) y = t.cej + (up ? -1 : 1) * t.h * .55;
  else if (t.partial) y = up ? t.bot - t.h * .3 : t.top + t.h * .3;
  const x = ((t.xl + t.xr) / 2) * (scene.mirror ? -1 : 1);
  // never outside the frame's opening (the review's "dot on the cheek")
  const [bx, by, bw, bh] = scene.box;
  return { x: Math.min(bx + bw - 3, Math.max(bx + 3, x)), y: Math.min(by + bh - 3, Math.max(by + 3, y)) };
}

/** Neighbouring dots never overlap: an upper and a lower dot move apart up and down, two on one arch sideways. */
export function spread<T extends { x: number; y: number; upper: boolean }>(dots: T[], gap: number): T[] {
  const out = dots.map((d) => ({ ...d }));
  for (let i = 0; i < out.length; i++) {
    for (let j = i + 1; j < out.length; j++) {
      const a = out[i], b = out[j];
      if (a === undefined || b === undefined) continue;
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (dist >= gap) continue;
      const push = (gap - dist) / 2;
      if (a.upper !== b.upper) {
        const [up, down] = a.upper ? [a, b] : [b, a];
        up.y -= push; down.y += push;
      } else {
        const [left, right] = a.x <= b.x ? [a, b] : [b, a];
        left.x -= push; right.x += push;
      }
    }
  }
  return out;
}

/** A tooth's tap area in screen millimetres. */
export function toothRect(scene: SmileScene, t: PaintTooth): { x: number; y: number; w: number; h: number } {
  const m = scene.mirror ? -1 : 1;
  const a = t.xl * m, b = t.xr * m;
  return { x: Math.min(a, b) - .15, y: t.arch === "u" ? t.top - 2 : t.top, w: Math.abs(b - a) + .3, h: t.bot - t.top + 2 };
}

/* ---------- canvas painting ---------- */
export interface PaintOptions {
  shade: Shade;
  theme: "light" | "dark";
}

const P2D = new Map<string, Path2D>();
const path = (d: string) => { let p = P2D.get(d); if (p === undefined) { p = new Path2D(d); P2D.set(d, p); } return p; };

function mix(a: string, b: string, t: number): string {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const A = p(a), B = p(b);
  return `#${A.map((v, i) => Math.round(v * (1 - t) + (B[i] ?? 0) * t).toString(16).padStart(2, "0")).join("")}`;
}

function toothXf(ctx: CanvasRenderingContext2D, t: PaintTooth, base: DOMMatrix, c: FrontCrown) {
  const [cx, cy, cw, ch] = boxOf(c);
  const w = t.xr - t.xl, h = t.bot - t.top;
  ctx.setTransform(base);
  // a partly erupted crown sits half under the gum
  const sink = t.partial ? h * .45 * (t.arch === "u" ? -1 : 1) : 0;
  ctx.translate(t.xl, t.top + sink);
  ctx.scale(w / cw, h / ch);
  if (t.side > 0) { ctx.translate(cw, 0); ctx.scale(-1, 1); }
  if (t.arch === "u") { ctx.translate(0, ch); ctx.scale(1, -1); }
  ctx.translate(-cx, -cy);
  return { cx, cy, cw, ch, unit: cw / w };
}

function paintTooth(ctx: CanvasRenderingContext2D, base: DOMMatrix, t: PaintTooth, atlas: FrontAtlas, o: PaintOptions) {
  const c = atlas[t.type];
  const cols = t.faded ? FADED : t.primary ? MILK : shadeRamp(o.shade);
  const ant = t.n <= 2;
  const crownP = path(c.crown);
  ctx.save();
  const { cx, cy, cw, ch, unit } = toothXf(ctx, t, base, c);
  ctx.clip(crownP);
  const g = ctx.createLinearGradient(0, cy, 0, cy + ch);
  if (ant) {
    g.addColorStop(0, mix("#b9c2c8", cols[0], .45)); g.addColorStop(.12, mix("#dfe2df", cols[0], .7));
    g.addColorStop(.32, cols[0]); g.addColorStop(.7, cols[1]); g.addColorStop(1, cols[2]);
  } else { g.addColorStop(0, cols[0]); g.addColorStop(.45, cols[1]); g.addColorStop(1, cols[2]); }
  ctx.fillStyle = g; ctx.fillRect(cx - 5, cy - 5, cw + 10, ch + 10);
  const base1 = ctx.globalAlpha;
  ctx.globalAlpha = base1 * (ant ? .09 : .06); ctx.fillStyle = "#fffaf0";
  for (const d of [c.lobe0, c.lobe1, c.lobe2]) if (d !== undefined) ctx.fill(path(d));
  ctx.globalAlpha = base1;
  // rounded form: edges turn away from the light, the distal side darker. A cool grey shadow, lighter
  // on the turned (back) teeth, whose narrow crowns would otherwise be all edge and read brown.
  const hz = ctx.createLinearGradient(cx, 0, cx + cw, 0);
  const near = .3 - .14 * t.turn, far = .36 - .14 * t.turn;
  const sh = (a: number) => `rgba(74,66,64,${a.toFixed(2)})`;
  hz.addColorStop(0, sh(far)); hz.addColorStop(.1, sh(far * .4)); hz.addColorStop(.28, sh(0));
  hz.addColorStop(.72, sh(0)); hz.addColorStop(.9, sh(near * .4)); hz.addColorStop(1, sh(near));
  ctx.fillStyle = hz; ctx.fillRect(cx - 2, cy - 2, cw + 4, ch + 4);
  const nk = ctx.createLinearGradient(0, cy + ch * .66, 0, cy + ch);
  nk.addColorStop(0, "rgba(176,140,96,0)"); nk.addColorStop(1, `rgba(176,140,96,${(.2 - .08 * t.turn).toFixed(2)})`);
  ctx.fillStyle = nk; ctx.fillRect(cx - 2, cy, cw + 4, ch + 2);
  if (!t.faded) {
    const rg = ctx.createRadialGradient(cx + cw * .45, cy + ch * .4, 1, cx + cw * .45, cy + ch * .4, cw * .4);
    rg.addColorStop(0, `rgba(255,255,255,${(.6 * (.42 - .2 * t.turn)).toFixed(2)})`); rg.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = rg;
    if (c.specular !== undefined) ctx.fill(path(c.specular));
    ctx.globalAlpha = base1 * .6; if (c.specular2 !== undefined) ctx.fill(path(c.specular2)); ctx.globalAlpha = base1;
  }
  // deeper in the mouth, a little less light: a soft cool veil, never a brown cast
  const dk = Math.min(.14, Math.max(0, (t.z - 10) / 110));
  if (dk > 0) { ctx.fillStyle = `rgba(60,64,72,${dk.toFixed(2)})`; ctx.fillRect(cx - 2, cy - 2, cw + 4, ch + 4); }
  if (t.n <= 3 && c.incisalHalo !== undefined) { ctx.lineWidth = 1.2; ctx.strokeStyle = "rgba(255,255,255,.28)"; ctx.stroke(path(c.incisalHalo)); }
  if (t.faded) { ctx.fillStyle = "rgba(236,238,240,.38)"; ctx.fillRect(cx - 2, cy - 2, cw + 4, ch + 4); }
  ctx.restore();
  ctx.save();
  toothXf(ctx, t, base, c);
  ctx.lineWidth = .14 * unit; ctx.strokeStyle = "rgba(110,80,55,.3)"; ctx.stroke(crownP);
  ctx.restore();
}

/** One continuous gum along a row; a recorded gap shows the ridge. */
function gumShape(row: PaintTooth[], upper: boolean, edge: number): Path2D {
  const dir = upper ? 1 : -1;
  const pts: [number, number, number][] = [];
  row.forEach((t, i) => {
    const w = t.xr - t.xl, front = Math.max(0, 1 - t.z / 24);
    const zx = (t.xl + t.xr) / 2 + (t.side > 0 ? .12 : -.12) * w;
    if (i === 0) pts.push([t.xl - 2, t.cej + dir * 1.2, 0]);
    if (t.missing) { const hh = t.h; pts.push([t.xl + w * .05, t.cej + dir * hh * .3, 0], [zx, t.cej + dir * hh * .42, 0], [t.xr - w * .05, t.cej + dir * hh * .32, 0]); }
    else pts.push([zx, t.cej + dir * .55 * t.sc, 0]);
    const n = row[i + 1];
    if (n !== undefined) {
      const hh = Math.min(t.h, n.h), depth = (.2 + .2 * front) * hh;
      const ridge = t.missing || n.missing;
      pts.push([(t.xr + n.xl) / 2, (t.cej + n.cej) / 2 + dir * (ridge ? hh * .26 : depth), ridge ? 0 : 1]);
    } else pts.push([t.xr + 2, t.cej + dir * 1.2, 0]);
  });
  const p = new Path2D();
  const first = pts[0] ?? [0, 0, 0];
  p.moveTo(first[0] - 30, first[1]); p.lineTo(first[0], first[1]);
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1] ?? first, b = pts[i] ?? first;
    if (b[2] === 1) p.bezierCurveTo(a[0] + (b[0] - a[0]) * .55, a[1], b[0] - (b[0] - a[0]) * .18, b[1] - (b[1] - a[1]) * .7, b[0], b[1]);
    else if (a[2] === 1) p.bezierCurveTo(a[0] + (b[0] - a[0]) * .18, a[1] - (a[1] - b[1]) * .7, b[0] - (b[0] - a[0]) * .55, b[1], b[0], b[1]);
    else p.bezierCurveTo(a[0] + (b[0] - a[0]) * .4, a[1], b[0] - (b[0] - a[0]) * .4, b[1], b[0], b[1]);
  }
  const last = pts[pts.length - 1] ?? first;
  p.lineTo(last[0] + 30, last[1]); p.lineTo(last[0] + 30, edge); p.lineTo(first[0] - 30, edge); p.closePath();
  return p;
}

function paintGum(ctx: CanvasRenderingContext2D, shape: Path2D, upper: boolean, y0: number, y1: number) {
  for (const [d, a] of [[.32, .14], [.16, .18]] as const) { ctx.save(); ctx.translate(0, upper ? d : -d); ctx.fillStyle = `rgba(70,14,20,${String(a)})`; ctx.fill(shape); ctx.restore(); }
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  g.addColorStop(0, "#9c3d4b"); g.addColorStop(.45, "#c8656f"); g.addColorStop(.85, "#e28e92"); g.addColorStop(1, "#eda3a3");
  ctx.fillStyle = g; ctx.fill(shape);
  ctx.save(); ctx.lineWidth = .25; ctx.strokeStyle = "rgba(255,214,210,.35)"; ctx.stroke(shape); ctx.restore();
}

function paintGhost(ctx: CanvasRenderingContext2D, t: PaintTooth, atlas: FrontAtlas, tilt: number) {
  const c = atlas[t.type];
  const [ax, ay, aw, ah] = boxOf(c);
  const w = (t.xr - t.xl) * 1.05, h = t.h;
  const up = t.arch === "u";
  const cx = (t.xl + t.xr) / 2, cy = t.cej + (up ? -1 : 1) * h * .55;
  ctx.save();
  ctx.translate(cx, cy);
  // mesial is towards the midline: a forward tilt leans the crown towards x = 0
  ctx.rotate(-t.side * tilt * (up ? -1 : 1));
  if (t.side > 0) ctx.scale(-1, 1);
  if (up) ctx.scale(1, -1);
  ctx.scale(w / aw, h / ah); ctx.translate(-ax - aw / 2, -ay - ah / 2);
  const p = path(c.crown);
  ctx.fillStyle = "rgba(250,240,220,.42)"; ctx.fill(p);
  ctx.setLineDash([3, 2.2]); ctx.lineWidth = 1.6; ctx.strokeStyle = "rgba(255,255,255,.95)"; ctx.stroke(p);
  ctx.restore();
}

const FRAME_COLOURS = {
  light: { outer: ["#eef0f2", "#d9dde2"], rim: "rgba(60,66,74,.35)" },
  dark: { outer: ["#2c3238", "#1c2025"], rim: "rgba(0,0,0,.55)" },
} as const;

/** Paints the scene onto a canvas already sized in device pixels. Returns the time it took in ms. */
export function paintSmile(canvas: HTMLCanvasElement, scene: SmileScene, atlas: FrontAtlas, o: PaintOptions): number {
  const t0 = performance.now();
  const ctx = canvas.getContext("2d");
  if (ctx === null) return 0;
  const { teeth, box, frame: fr } = scene;
  const mir = scene.mirror ? -1 : 1;
  const k = canvas.width / box[2];
  const base = new DOMMatrix().scale(k, k).translate(-box[0], -box[1]).scale(mir, 1);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(base);
  // the neutral frame: no lips, no skin tone (review minor 17)
  const fc = FRAME_COLOURS[o.theme];
  const bg = ctx.createRadialGradient(0, fr.Yk, 4, 0, fr.Yk, fr.Xc * 1.6);
  bg.addColorStop(0, fc.outer[0]); bg.addColorStop(1, fc.outer[1]);
  ctx.fillStyle = bg; ctx.fillRect(box[0] * mir - box[2], box[1] - 2, box[2] * 3, box[3] + 4);
  const yU = (x: number) => { const u = Math.min(1, Math.abs(x) / fr.Xc); return fr.Yk + (fr.Ytop - fr.Yk) * (1 - Math.pow(u, 5)); };
  const yL = (x: number) => { const u = Math.min(1, Math.abs(x) / fr.Xc); return fr.Yk + (fr.Ybot - fr.Yk) * (1 - Math.pow(u, 5)); };
  const op = new Path2D();
  const N = 48;
  for (let i = 0; i <= N; i++) { const x = -fr.Xc + 2 * fr.Xc * i / N; if (i === 0) op.moveTo(x, yU(x)); else op.lineTo(x, yU(x)); }
  for (let i = N; i >= 0; i--) { const x = -fr.Xc + 2 * fr.Xc * i / N; op.lineTo(x, yL(x)); }
  op.closePath();
  // soft drop shadow of the opening on the frame
  ctx.save(); ctx.shadowColor = fc.rim; ctx.shadowBlur = 6 * k; ctx.fillStyle = "#1a0a0e"; ctx.fill(op); ctx.restore();
  ctx.save(); ctx.clip(op);
  const mi = ctx.createRadialGradient(0, (fr.Ytop + fr.Ybot) / 2, 2, 0, (fr.Ytop + fr.Ybot) / 2, fr.Xc);
  mi.addColorStop(0, "#5a1d22"); mi.addColorStop(.55, "#2e0d12"); mi.addColorStop(1, "#14050a");
  ctx.fillStyle = mi; ctx.fillRect(-fr.Xc - 5, fr.Ytop - 5, 2 * fr.Xc + 10, fr.Ybot - fr.Ytop + 10);
  const row = (arch: "u" | "l") => teeth.filter((t) => t.arch === arch && !t.hidden && t.ghost === undefined).sort((a, b) => a.xl - b.xl);
  const solid = (arch: "u" | "l") => teeth.filter((t) => t.arch === arch && !t.hidden && !t.missing && t.ghost === undefined).sort((a, b) => b.z - a.z);
  const Lrow = row("l"), Urow = row("u");
  for (const t of solid("l")) paintTooth(ctx, base, t, atlas, o);
  ctx.setTransform(base);
  if (Lrow.length > 0) paintGum(ctx, gumShape(Lrow, false, fr.Ybot + 12), false, fr.Ybot + 4, Math.min(...Lrow.map((t) => t.cej)) - 2.5);
  for (const t of solid("u")) paintTooth(ctx, base, t, atlas, o);
  ctx.setTransform(base);
  if (Urow.length > 0) paintGum(ctx, gumShape(Urow, true, fr.Ytop - 12), true, fr.Ytop - 4, Math.max(...Urow.map((t) => t.cej)) + 2.5);
  for (const t of teeth) if (!t.hidden && t.ghost !== undefined) { ctx.setTransform(base); paintGhost(ctx, t, atlas, t.ghost); }
  ctx.setTransform(base);
  for (const [lw, a] of [[1.1, .16], [.5, .3]] as const) { ctx.lineWidth = lw; ctx.strokeStyle = `rgba(12,4,4,${String(a)})`; ctx.stroke(op); }
  const cv = ctx.createLinearGradient(-fr.Xc, 0, fr.Xc, 0);
  for (const [o2, a] of [[0, .34], [.06, .12], [.13, 0], [.87, 0], [.94, .12], [1, .34]] as const) cv.addColorStop(o2, `rgba(14,4,6,${String(a)})`);
  ctx.fillStyle = cv; ctx.fillRect(-fr.Xc - 2, fr.Ytop - 2, 2 * fr.Xc + 4, fr.Ybot - fr.Ytop + 4);
  ctx.restore();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  return performance.now() - t0;
}
