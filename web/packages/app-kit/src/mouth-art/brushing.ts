// The brushing loop (§1.4): about 6 s, outer -> inner -> chewing surfaces (+ floss from teen),
// a parent's hand for children, paste by age, an optional highlighted tooth. Framework-free: a pose
// for a time, and a Scene for a pose; the React wrapper adds Pause/Play and reduced-motion stills.
import { SceneBuilder, mul, rotateAbout, translate, type ResolveSource } from "./scene.js";
import type { ArtLayer, BrushingArt, Matrix, Scene } from "./types.js";
import type { BrushingBand } from "./stage-steps.js";

export const LOOP_MS = 6000;

export type BrushPhase = "outer" | "inner" | "chewing" | "floss";

export interface BandInfo {
  title: string;
  chips: string[];
  phases: BrushPhase[];
  parentHand: boolean;
}

export const BAND_INFO: Record<BrushingBand, BandInfo> = {
  general_under_6: { title: "How to brush, under 6", chips: ["A smear of fluoride paste under 3", "Pea-sized paste from 3 to 6", "A parent brushes", "2 minutes, twice a day"], phases: ["outer", "inner", "chewing"], parentHand: true },
  general_6_12: { title: "How to brush, 6 to 12", chips: ["Pea-sized fluoride paste", "A parent helps", "2 minutes, twice a day"], phases: ["outer", "inner", "chewing"], parentHand: true },
  general_teen: { title: "How to brush and floss", chips: ["Pea-sized fluoride paste", "2 minutes, twice a day", "Floss once a day"], phases: ["outer", "inner", "chewing", "floss"], parentHand: false },
  general_adult: { title: "How to brush and floss", chips: ["Pea-sized fluoride paste", "2 minutes, twice a day", "Floss once a day"], phases: ["outer", "inner", "chewing", "floss"], parentHand: false },
};

export const PHASE_CAPTION: Record<BrushPhase, { title: string; text: string }> = {
  outer: { title: "Outer sides", text: "Tilt the brush toward the gum line. Small circles, tooth by tooth." },
  inner: { title: "Inner sides", text: "Hold the brush upright behind the front teeth. Small up-and-down strokes." },
  chewing: { title: "Chewing sides", text: "Brush the tops of the back teeth with short back-and-forth strokes." },
  floss: { title: "Floss", text: "Curve the floss round each tooth and slide it gently under the gum line." },
};

export interface BrushPose {
  phase: BrushPhase;
  x: number;
  y: number;
  rot: number;
  /** Floss offset. */
  dy: number;
  /** Brush drawn behind the lower teeth (inner sides). */
  behind: boolean;
}

/** The pose at time t (ms). With `still`, the phase's middle without motion. */
export function brushingPose(band: BrushingBand, t: number, still = false): BrushPose {
  const phases = BAND_INFO[band].phases;
  const per = LOOP_MS / phases.length;
  const tt = ((t % LOOP_MS) + LOOP_MS) % LOOP_MS;
  const i = Math.min(phases.length - 1, Math.floor(tt / per));
  const phase = phases[i] ?? "outer";
  const u = still ? 0.5 : (tt - i * per) / per;
  const w = still ? 0 : (tt / 1000) * Math.PI * 2 * 3;
  const r = still ? 0 : 2.2;
  switch (phase) {
    case "outer": return { phase, x: 122 + 76 * u + Math.cos(w) * r, y: 92 + Math.sin(w) * r, rot: -12, dy: 0, behind: false };
    case "inner": return { phase, x: 160, y: 121 + Math.sin(w) * r * 1.4, rot: 90, dy: 0, behind: true };
    case "chewing": return { phase, x: 100 + Math.sin(w * 0.8) * 5, y: 112, rot: 180, dy: 0, behind: false };
    case "floss": return { phase, x: 0, y: 0, rot: 0, dy: still ? 0 : 3 + Math.sin(w * 0.7) * 3, behind: false };
  }
}

const MIRROR: Matrix = [-1, 0, 0, 1, 320, 0];
const RIGHT_OF: Record<string, string> = { "2": "1", "3": "4", "6": "5", "7": "8" };

/** Finds the drawn crown for an FDI number (or its nearest drawn neighbour) and whether it's mirrored. */
function findTooth(art: BrushingArt, fdi: number): { d: string; mirrored: boolean } | undefined {
  const q = String(Math.floor(fdi / 10)), pos = fdi % 10;
  const mirrored = q in RIGHT_OF;
  const rq = Number(RIGHT_OF[q] ?? q);
  const upper = rq === 1 || rq === 5;
  const row = upper ? art.upper : art.lower;
  const alt = rq >= 5 ? rq - 4 : rq + 4;
  for (let p = pos; p >= 1; p--) {
    const d = row.teeth[String(rq * 10 + p)] ?? row.teeth[String(alt * 10 + p)];
    if (d !== undefined) return { d, mirrored };
  }
  return undefined;
}

export interface BrushingSceneOptions {
  /** FDI number of a tooth to highlight softly ("brush gently around the tooth"). */
  highlight?: number;
}

export function brushingScene(art: BrushingArt, band: BrushingBand, pose: BrushPose, opts: BrushingSceneOptions = {}): Scene {
  const b = new SceneBuilder();
  const base = (extra: Partial<ResolveSource> = {}): ResolveSource => ({ shade: "A1", gradients: art.g, slots: {}, anchors: {}, clips: { opening: art.opening, outside: art.outside }, ...extra });
  const M = mul(translate(pose.x, pose.y), mul(rotateAbout(pose.rot, 0, 0), [art.brushScale, 0, 0, art.brushScale, 0, 0]));
  const brushLayers = (clip?: string): ArtLayer[] => [...art.brush, ...art.paste, ...(BAND_INFO[band].parentHand ? art.hand : [])]
    .map((l) => ({ ...l, tr: l.tr ? mul(M, l.tr) : M, ...(clip ? { c: clip } : {}) }));
  b.add(art.back, base());
  const showBrush = pose.phase !== "floss";
  if (showBrush && pose.behind) b.add(brushLayers("opening"), base());
  for (const [key, row] of [["l", art.lower], ["u", art.upper]] as const) {
    const all = Object.values(row.teeth).join("");
    const layers: ArtLayer[] = [
      { n: "teeth", d: all, f: row.fill },
      { n: "shade", d: row.shades, f: "shadow", o: 0.16, c: "row" },
      { n: "shine", d: row.highlights, f: "white", o: 0.3, c: "row" },
      { n: "rim", d: all, s: "shadow", w: 0.8, o: 0.35 },
    ];
    b.add(layers, base({ clips: { row: all }, prefix: key + "R-" }));
    b.add(layers, base({ clips: { row: all }, prefix: key + "L-", group: MIRROR }));
    b.add([{ n: "gum", d: row.gum, f: row.gumFill, c: "opening" }, { n: "gumEdge", d: row.gum, s: "gumDeep", w: 0.6, o: 0.4, c: "opening" }], base());
  }
  if (opts.highlight !== undefined) {
    const t = findTooth(art, opts.highlight);
    if (t) {
      const hl: ArtLayer[] = [
        { n: "glow", d: t.d, s: "#2BB39A", w: 7, o: 0.22 },
        { n: "tint", d: t.d, f: "white", o: 0.25 },
        { n: "ring", d: t.d, s: "#1E9E86", w: 2.2, o: 0.95 },
      ];
      b.add(hl, base(t.mirrored ? { group: MIRROR } : {}));
    }
  }
  if (showBrush && !pose.behind) b.add(brushLayers("opening"), base({ prefix: "in-" }));
  if (pose.phase === "floss") b.add(art.floss.map((l) => ({ ...l, tr: translate(0, pose.dy) })), base());
  b.add(art.front, base());
  if (showBrush) b.add(brushLayers("outside"), base({ prefix: "out-" }));
  return b.build(art.box);
}
