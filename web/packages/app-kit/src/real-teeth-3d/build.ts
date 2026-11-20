// Builds the meshes of a resolved scene: tooth layers (enamel, dentin, pulp, decay, work), the
// alveolar ridge (bone and scalloped gum) and treatment parts. Pure arrays, no three.js.
import type { CariesDepth, Surface } from "../mouth-art/overlays.js";
import type { ToothType } from "../mouth-art/types.js";
import {
  aoAt, at, capT, clamp, combine, fill, forBox, makeGrid, mix, sample, smax, smin, sstep, surfaceNets, vnoise,
  type ColorFn, type Field, type Grid, type MeshData, type Vec3,
} from "./sdf.js";
import type { Cavity, Look, SceneSpec } from "./spec.js";
import { toothGrid, type ToothGrid } from "./teeth.js";

export type Kind =
  | "gum" | "bone" | "cancellous" | "enamel" | "dentin" | "pulp" | "decaySoft" | "decayDark" | "pressure" | "abscess" | "clot"
  | "calculus" | "composite" | "amalgam" | "gold" | "temporary" | "medicament" | "core" | "gp" | "sealant" | "crown" | "implant" | "abutment";

/** Draw order; on a cut face the later kind wins. */
export const KIND_ORDER: readonly Kind[] = [
  "gum", "bone", "cancellous", "abscess", "clot", "enamel", "dentin", "pulp", "decaySoft", "decayDark", "pressure", "calculus",
  "composite", "amalgam", "gold", "temporary", "medicament", "core", "gp", "sealant", "crown", "implant", "abutment",
];

export type Enter = "drop" | "fade" | "screw";
export interface Layer {
  kind: Kind;
  mesh: MeshData;
  /** Only drawn as a cut face in the Inside view. */
  capOnly?: boolean;
  look?: Look;
  enter?: Enter;
  label?: string;
  /** Index without the triangles buried under enamel (outside views, where no cut face is drawn). */
  outer?: Uint16Array | Uint32Array;
}
export interface Part {
  name: "tooth" | "neighbor" | "perio" | "implant";
  position: Vec3;
  /** Rotation about z (radians). */
  rz: number;
  layers: Layer[];
}
export interface Anchor { text: string; p: Vec3; part: Part["name"]; warn?: boolean }
export interface Built {
  parts: Part[];
  /** Local plane of the Inside view: z = cut (or x = cut when spec.cut is "x"). */
  cut: number;
  /** Bounds of the framed content (local). */
  min: Vec3;
  max: Vec3;
  /** Crown centre, the target of the top view. */
  crown: Vec3;
  /** Lowest point the front view needs (the crown and the upper roots, or the whole tooth). */
  focusY: number;
  /** Inside-view label points (local to their part). */
  insideAnchors: Anchor[];
  tris: number;
}

export const QUALITY = { coarse: { tooth: 0.46, perio: 0.8 }, fine: { tooth: 0.3, perio: 0.62 } } as const;
export type Quality = keyof typeof QUALITY;

const DEPTH_INDEX: Record<CariesDepth, number> = { enamel: 0, dentin: 1, near_pulp: 2 };
const CAV_NECK = [0.5, 0.65, 0.75], CAV_BODY: Vec3[] = [[0.75, 0.55, 0.65], [1.75, 1.0, 1.45], [2.0, 1.4, 1.6]];
const CAV_TARGET: { f: "D" | "P"; c: number }[] = [{ f: "D", c: 0.3 }, { f: "P", c: 1.15 }, { f: "P", c: 0.18 }];

interface Cav { o: Vec3; u: Vec3; neck: number; prepNeck: number; R: Vec3; L: number; d: number }

function cavityGeom(t: ToothGrid, c: Cavity): Cav {
  const m = t.model, s = m.size, ant = m.family === "anterior";
  const yProx = m.crownTop * (ant ? 0.66 : 0.72), yCerv = m.cej(0, m.halfBL) + (ant ? 1.6 : 1.4);
  const zo = ant ? 0.7 * s : 0;
  const by: Record<Surface, [Vec3, Vec3]> = {
    O: [[ant ? 0 : 0.6 * s, m.crownTop + 1.6, ant ? 0.2 : 0], [0, -1, 0]],
    M: [[m.halfMD + 1.4, yProx, zo], [-1, 0, 0]],
    D: [[-m.halfMD - 1.4, yProx, zo], [1, 0, 0]],
    B: [[0, yCerv, m.halfBL + 1.4], [0, 0, -1]],
    L: [[0, yCerv + (ant ? 2 : 0), -m.halfBL - 1.4], [0, 0, 1]],
  };
  const [o, u] = by[c.surface], L = DEPTH_INDEX[c.depth], k = ant ? 0.62 : s;
  const b = CAV_BODY[L] ?? [1, 1, 1];
  // the body's "along" radius follows the direction; the others stay lateral
  const R: Vec3 = u[1] !== 0 ? [b[0] * k, b[1] * k, b[2] * k] : u[0] !== 0 ? [b[1] * k, b[0] * k, b[2] * k] : [b[0] * k, b[2] * k, b[1] * k];
  const cav: Cav = { o, u, neck: (CAV_NECK[L] ?? 0.6) * k, prepNeck: (ant ? 0.8 : 1.15) * k, R, L, d: 0 };
  cav.d = cavDepth(t, cav, CAV_TARGET[L] ?? { f: "P", c: 1 });
  return cav;
}
function cavF(c: Cav, x: number, y: number, z: number, noisy: boolean): number {
  const { o, u } = c, bx = o[0] + u[0] * c.d, by = o[1] + u[1] * c.d, bz = o[2] + u[2] * c.d;
  const rn = noisy ? c.neck : c.prepNeck;
  const neck = capT(x, y, z, [o[0] - u[0] * 1.5, o[1] - u[1] * 1.5, o[2] - u[2] * 1.5], [bx, by, bz], rn, rn * 0.85);
  const R = c.R, s = noisy ? 1 : 0.92;
  const ex = (x - bx) / (R[0] * s), ey = (y - by) / (R[1] * s), ez = (z - bz) / (R[2] * s);
  let f = smin(neck, (Math.sqrt(ex * ex + ey * ey + ez * ez) - 1) * Math.min(R[0], R[1], R[2]) * s, 0.6);
  if (noisy) f += 0.16 * vnoise(x * 1.7 + 3.1, y * 1.7, z * 1.7) + 0.06 * vnoise(x * 4.2, y * 4.2 + 1.3, z * 4.2);
  return f;
}
function cavBox(c: Cav, d: number): [Vec3, Vec3] {
  const { o, u } = c, R = Math.max(...c.R) + Math.max(c.neck, c.prepNeck) + 0.8;
  const a = [o[0] - u[0] * 1.5, o[1] - u[1] * 1.5, o[2] - u[2] * 1.5], b = [o[0] + u[0] * d, o[1] + u[1] * d, o[2] + u[2] * d];
  const lo = (i: number): number => Math.min(at(a, i), at(b, i)) - R, hi = (i: number): number => Math.max(at(a, i), at(b, i)) + R;
  return [[lo(0), lo(1), lo(2)], [hi(0), hi(1), hi(2)]];
}
/** Deepest travel that keeps the cavity short of the target layer distance. */
function cavDepth(t: ToothGrid, c: Cav, tg: { f: "D" | "P"; c: number }): number {
  const F = t.f[tg.f];
  let lo = 0.3, hi = 12;
  for (let it = 0; it < 14; it++) {
    const d = (lo + hi) / 2, [b0, b1] = cavBox(c, d);
    let m = 99;
    const probe = { ...c, d };
    forBox(t.g, b0, b1, (p, x, y, z) => { const v = at(F, p); if (v < m && cavF(probe, x, y, z, true) < 0) m = v; });
    if (m > tg.c) lo = d; else hi = d;
  }
  return lo;
}

const DECAY_MID = [0.62, 0.43, 0.27], DECAY_DARK = [0.13, 0.08, 0.05];
function decayMul(c: number, out: Float64Array): void {
  const k1 = 1 - sstep(0.0, 1.5, c), k2 = 1 - sstep(0.05, 0.55, c);
  for (let i = 0; i < 3; i++) out[i] = mix(mix(at(out, i), at(out, i) * at(DECAY_MID, i), k1), at(DECAY_DARK, i), k2);
}
const aoColor = (g: Grid, F: Field, soft = 0.3): ColorFn => (x, y, z, nx, ny, nz, out) => {
  const a = mix(aoAt(g, F, x, y, z, nx, ny, nz), 1, soft);
  out[0] = a; out[1] = a; out[2] = a;
};

interface ToothOpts {
  spec: SceneSpec;
  /** Wisdom roots still forming (impacted / unerupted). */
  shortRoots?: boolean;
  /** Extra colour per vertex (pressure from a neighbour). */
  extra?: (x: number, y: number, z: number, out: Float64Array) => void;
  /** Treat as a plain healthy tooth (the neighbour in a wisdom scene). */
  plain?: boolean;
}

/** Layers of one tooth, local to the tooth. */
function toothLayers(t: ToothGrid, o: ToothOpts): { layers: Layer[]; fields: Partial<Record<Kind, Field>> } {
  const { g, f, model: m } = t, s = o.spec, n = g.n;
  const plain = o.plain === true;
  let E: Field | null = f.E, D = f.D, P: Field | null = f.P;
  const out: Layer[] = [], fields: Partial<Record<Kind, Field>> = {};
  const add = (l: Layer, F: Field): void => { out.push(l); fields[l.kind] = F; };
  const op = (A: Field, B: Field, fn: (a: number, b: number) => number): Field => combine(g, (p) => fn(at(A, p), at(B, p)));
  if (o.shortRoots) {
    const cutY = Math.min(...m.apexes.map((a) => a[1])) * 0.55;
    const clip = (F: Field): Field => fill(g, (_x, y, _z, p) => smax(at(F, p), cutY - y, 0.5));
    D = clip(D);
    P = fill(g, (_x, y, _z, p) => Math.max(at(f.P, p) - 0.45 * sstep(cutY + 3, cutY, y), cutY - 0.2 - y));
  }
  let cavFn: ((x: number, y: number, z: number) => number) | null = null;
  const cavs = plain ? [] : s.cavities.map((c) => ({ c, g: cavityGeom(t, c) }));
  const decay = cavs.filter((c) => c.c.state === "decay"), prepped = cavs.filter((c) => c.c.state !== "decay");
  if (decay.length) {
    const fn = (x: number, y: number, z: number): number => Math.min(...decay.map((c) => cavF(c.g, x, y, z, true)));
    cavFn = fn;
    const C = fill(g, fn);
    E = op(E, C, (e, c) => smax(e, -c, 0.12));
    D = op(D, C, (e, c) => smax(e, -c, 0.12));
    const Tt = op(E, D, Math.min);
    add({ kind: "decaySoft", mesh: surfaceNets(g, op(Tt, C, (tt, c) => Math.max(tt, c - 1.0, -c))), capOnly: true }, op(Tt, C, (tt, c) => Math.max(tt, c - 1.0, -c)));
    const dark = op(Tt, C, (tt, c) => Math.max(tt, c - 0.4, -c));
    add({ kind: "decayDark", mesh: surfaceNets(g, dark), capOnly: true, label: "Decay" }, dark);
  }
  if (prepped.length) {
    const C = fill(g, (x, y, z) => Math.min(...prepped.map((c) => cavF({ ...c.g, d: c.g.d * 0.97 }, x, y, z, false))));
    E = op(E, C, (e, c) => smax(e, -c, 0.08));
    D = op(D, C, (e, c) => smax(e, -c, 0.08));
    for (const look of new Set(prepped.filter((c) => c.c.state === "filled").map((c) => c.c.look))) {
      const mine = prepped.filter((c) => c.c.state === "filled" && c.c.look === look);
      const Cm = fill(g, (x, y, z, p) => Math.max(Math.min(...mine.map((c) => cavF({ ...c.g, d: c.g.d * 0.97 }, x, y, z, false))) - 0.08, at(f.S, p)));
      const kind: Kind = look === "amalgam" || look === "metal" ? "amalgam" : look === "gold" ? "gold" : look === "temporary" ? "temporary" : "composite";
      add({ kind, look, mesh: surfaceNets(g, Cm, kind === "composite" ? (x, y, z, nx, ny, nz, o2) => { aoColor(g, Cm, 0.3)(x, y, z, nx, ny, nz, o2); o2[0] = at(o2, 0) * 0.955; o2[1] = at(o2, 1) * 0.962; o2[2] = at(o2, 2) * 0.975; } : aoColor(g, Cm)), enter: "drop", label: look === "temporary" ? "Temporary filling" : "Filling" }, Cm);
    }
  }
  // root canal
  if (!plain && s.access !== "none") {
    const A = fill(g, (x, y, z) => (s.access === "core" && s.canal === "pulp" ? Math.max(m.access(x, y, z), m.orificeY + 1.2 - y) : m.access(x, y, z)));
    E = op(E, A, (e, a) => smax(e, -a, 0.1));
    D = op(D, A, (e, a) => smax(e, -a, 0.1));
    const oy = m.orificeY, P0 = P;
    if (s.canal !== "pulp") {
      D = op(D, P0, (d, p) => Math.max(d, -p));
      P = null;
    }
    if (s.canal === "medicament") {
      const med = fill(g, (_x, y, _z, p) => Math.max(at(P0, p) + 0.02, y - (oy + 0.7)));
      add({ kind: "medicament", mesh: surfaceNets(g, med, aoColor(g, med)), enter: "fade", label: "Medicine inside" }, med);
      const tmp = fill(g, (_x, y, _z, p) => Math.max(Math.min(at(A, p), at(P0, p)), at(f.S, p) - 0.02, oy + 0.7 - y));
      add({ kind: "temporary", mesh: surfaceNets(g, tmp, aoColor(g, tmp)), enter: "drop", label: "Temporary filling" }, tmp);
    } else if (s.canal === "filled" || s.access === "core") {
      const core = fill(g, (_x, y, _z, p) => Math.max(Math.min(at(A, p), Math.max(at(P0, p), oy - y)), at(f.S, p) - 0.02));
      if (s.canal === "filled") {
        const gp = fill(g, (_x, y, _z, p) => Math.max(at(P0, p) - 0.1, y - oy));
        add({ kind: "gp", mesh: surfaceNets(g, gp, aoColor(g, gp)), enter: "fade", label: "Root filling" }, gp);
      }
      fields.core = core;
      if (s.crown === "none") add({ kind: "core", mesh: surfaceNets(g, core, aoColor(g, core)), enter: "drop", label: "Filling" }, core);
    }
  }
  // crown preparation and crown
  if (!plain && (s.crown === "prep" || s.crown === "crown")) {
    const D2 = new Float32Array(n), Cr = new Float32Array(n);
    for (let k = 0, p = 0; k < g.nz; k++) {
      const z = g.oz + k * g.h;
      for (let j = 0; j < g.ny; j++) {
        const y = g.oy + j * g.h;
        for (let i = 0; i < g.nx; i++, p++) {
          const x = g.ox + i * g.h, mY = m.cej(x, z) + 0.3, sv = at(f.S, p);
          if (y < mY - 0.6) { D2[p] = at(D, p); Cr[p] = 9; continue; }
          const red = m.crownRed(x, y, z);
          D2[p] = y < mY ? at(D, p) : smax(at(D, p), sv + red, 0.1);
          Cr[p] = Math.max(sv - 0.06, -(sv + red), mY - y);
        }
      }
    }
    combine(g, (p) => at(Cr, p)).forEach((v, i) => { Cr[i] = v; });
    D = combine(g, (p) => at(D2, p));
    E = null;
    const core = fields.core;
    if (core) {
      const c2 = op(core, D, Math.max);
      add({ kind: "core", mesh: surfaceNets(g, c2, aoColor(g, c2)), label: "Core" }, c2);
    }
    if (s.crown === "crown") add({ kind: "crown", look: s.crownLook, mesh: surfaceNets(g, Cr, aoColor(g, Cr)), enter: "drop", label: "Crown" }, Cr);
  }
  if (!plain && s.crown === "veneer") {
    const V = fill(g, (x, y, z, p) => Math.max(at(f.S, p) - 0.05, -(at(f.S, p) + 0.55), 0.4 - z, m.cej(x, z) + 0.4 - y));
    if (E) E = op(E, V, (e, v) => Math.max(e, -v));
    add({ kind: "crown", look: s.crownLook, mesh: surfaceNets(g, V, aoColor(g, V)), enter: "drop", label: "Veneer" }, V);
  }
  // tartar along the gum line
  if (!plain && s.calculus) {
    const ant = m.family === "anterior";
    const Cc = fill(g, (x, y, z, p) => {
      const c = m.cej(x, z), lingual = z < 0 ? 1.4 : 1;
      const th = (0.35 + 0.55 * Math.max(0, vnoise(x * 1.3, y * 1.3, z * 1.3) + 0.35)) * lingual * (ant ? 1.15 : 1);
      return Math.max(at(f.S, p) - th, -at(f.S, p) - 0.1, Math.abs(y - c - 1.1) - 1.4 * lingual - 0.4 * vnoise(x * 0.8, 2, z * 0.8));
    });
    add({ kind: "calculus", mesh: surfaceNets(g, Cc, aoColor(g, Cc)), enter: "fade", label: "Tartar" }, Cc);
  }
  // pit and fissure sealant: fills the grooves below the cusp envelope
  if (!plain && s.sealant && m.occl) {
    const occl = m.occl;
    const Sl = fill(g, (x, y, z, p) => {
      if (y < m.crownTop - 3.2) return 9;
      const inset = Math.hypot(x / (m.halfMD - 1.5), z / (m.halfBL - 1.7)) - 1;
      return Math.max(-at(f.S, p) - 0.55, y - (occl(x, z) - 0.1), inset * 2);
    });
    add({ kind: "sealant", mesh: surfaceNets(g, Sl, aoColor(g, Sl)), enter: "fade", label: "Sealant" }, Sl);
  }
  // colours
  const ao = (x: number, y: number, z: number, nx: number, ny: number, nz: number, o2: Float64Array, F: Field): void => {
    const a = aoAt(g, F, x, y, z, nx, ny, nz);
    o2[0] = at(o2, 0) * a; o2[1] = at(o2, 1) * mix(a, 1, 0.08) * (0.97 + 0.03 * a); o2[2] = at(o2, 2) * a * (0.93 + 0.07 * a);
  };
  const crack = s.fracture && !plain ? (x: number, y: number, z: number, o2: Float64Array): void => {
    if (y < m.cej(x, z) - 0.8) return;
    const d = Math.abs(z - 0.22 * x - 0.35 * m.size - 0.25 * vnoise(x * 1.1, y * 1.1, 4));
    const k = (1 - sstep(0.06, 0.32, d)) * sstep(m.cej(x, z) - 0.8, m.cej(x, z) + 1.5, y);
    for (let i = 0; i < 3; i++) o2[i] = mix(at(o2, i), at([0.36, 0.25, 0.17], i), k);
  } : null;
  const stain = s.fissureStain ? 1.6 : 1;
  const enamelCol = (Ef: Field): ColorFn => (x, y, z, nx, ny, nz, o2) => {
    const dd = sample(g, D, x, y, z);
    const thin = 1 - sstep(0.15, 1.3, dd), thk = m.tint * sstep(1.0, 2.1, dd);
    o2[0] = mix(1, 0.97, thin) * mix(1, 0.88, thk); o2[1] = mix(1, 0.9, thin) * mix(1, 0.91, thk); o2[2] = mix(1, 0.74, thin) * mix(1, 0.99, thk);
    m.grad?.(x, y, z, o2);
    if (m.fiss && !s.sealant) {
      const st = Math.min(1, m.fiss(x, y, z) * stain);
      o2[0] = at(o2, 0) * (1 - 0.26 * st); o2[1] = at(o2, 1) * (1 - 0.36 * st); o2[2] = at(o2, 2) * (1 - 0.48 * st);
    }
    ao(x, y, z, nx, ny, nz, o2, Ef);
    if (cavFn) decayMul(cavFn(x, y, z), o2);
    crack?.(x, y, z, o2);
    o.extra?.(x, y, z, o2);
  };
  const hollow = s.canal !== "pulp" && !plain;
  const dentinCol = (Df: Field): ColorFn => (x, y, z, nx, ny, nz, o2) => {
    const k = sstep(0.3, -0.6, y - m.cej(x, z));
    o2[0] = mix(1, 0.97, k); o2[1] = mix(1, 0.92, k); o2[2] = mix(1, 0.82, k);
    ao(x, y, z, nx, ny, nz, o2, Df);
    if (hollow) for (let i = 0; i < 3; i++) o2[i] = mix(at(o2, i), 0.95, 0.45);
    if (cavFn) decayMul(cavFn(x, y, z), o2);
    crack?.(x, y, z, o2);
    o.extra?.(x, y, z, o2);
  };
  const layers: Layer[] = [];
  if (E) { layers.push({ kind: "enamel", mesh: surfaceNets(g, E, enamelCol(E)), label: "Enamel" }); fields.enamel = E; }
  const dm = surfaceNets(g, D, dentinCol(D));
  layers.push({ kind: "dentin", mesh: dm, label: "Dentin", ...(E ? { outer: trimBuried(dm, g, E) } : {}) });
  fields.dentin = D;
  if (P) { layers.push({ kind: "pulp", mesh: surfaceNets(g, P), label: "Nerve (pulp)" }); fields.pulp = P; }
  return { layers: layers.concat(out), fields };
}

/** Drops triangles whose three vertices sit inside another surface. */
function trimBuried(mesh: MeshData, g: Grid, cover: Field): Uint16Array | Uint32Array {
  const P = mesh.position, I = mesh.index, keep: number[] = [];
  const buried = new Uint8Array(P.length / 3);
  for (let v = 0; v < buried.length; v++) buried[v] = sample(g, cover, at(P, v * 3), at(P, v * 3 + 1), at(P, v * 3 + 2)) < -0.12 ? 1 : 0;
  for (let i = 0; i < I.length; i += 3) {
    const a = at(I, i), b = at(I, i + 1), c = at(I, i + 2);
    if (!(at(buried, a) && at(buried, b) && at(buried, c))) keep.push(a, b, c);
  }
  return I instanceof Uint32Array ? new Uint32Array(keep) : new Uint16Array(keep);
}

// ------------------------------------------------------------------ ridge: bone and gum

/** Gum reaches this far below the bone crest (attached gingiva), then the bone shows. */
const GUM_DEPTH = 6.2;

interface Carver { tg: ToothGrid; at: Vec3; rz: number; gum: boolean; field?: Field; lift?: number }
interface Ridge {
  x0: number;
  x1: number;
  y0: number;
  ytop: number;
  W: (x: number, y: number) => number;
  crest: (x: number, z: number) => number;
  gumTop: (x: number, z: number) => number;
  teeth: Carver[];
  /** Extra carve of bone and gum (sockets, implants, lesions): negative inside. */
  boneCut: ((x: number, y: number, z: number) => number) | null;
  gumCut: ((x: number, y: number, z: number) => number) | null;
  inflamed: boolean;
}

function toLocal(c: Carver, x: number, y: number, z: number): Vec3 {
  const dx = x - c.at[0], dy = y - c.at[1] - (c.lift ?? 0), co = Math.cos(c.rz), si = Math.sin(c.rz);
  return [dx * co + dy * si, -dx * si + dy * co, z - c.at[2]];
}
function toothDist(c: Carver, x: number, y: number, z: number): number {
  const [lx, ly, lz] = toLocal(c, x, y, z), T = c.tg, b0 = T.model.bmin, b1 = T.model.bmax;
  if (lx < b0[0] - 1 || lx > b1[0] + 1 || ly < b0[1] - 1 || ly > b1[1] + 1 || lz < b0[2] - 1 || lz > b1[2] + 1) return 9;
  return Math.min(sample(T.g, c.field ?? T.f.S, lx, ly, lz), sample(T.g, T.f.D, lx, ly, lz));
}

function buildRidge(r: Ridge, h: number): { gum: MeshData; bone: MeshData; cancellous: MeshData; g: Grid; B: Field; G: Field } {
  const zr = Math.max(r.W(0, r.y0), r.W(r.x0, r.y0), r.W(r.x1, r.y0)) + 3;
  const g = makeGrid([r.x0 - 1.5, r.y0 - 1, -zr], [r.x1 + 1.5, r.ytop, zr], h);
  const B = new Float32Array(g.n), Gm = new Float32Array(g.n);
  const xm = (r.x0 + r.x1) / 2, xh = (r.x1 - r.x0) / 2;
  for (let k = 0, p = 0; k < g.nz; k++) {
    const z = g.oz + k * h;
    for (let j = 0; j < g.ny; j++) {
      const y = g.oy + j * h;
      for (let i = 0; i < g.nx; i++, p++) {
        const x = g.ox + i * h;
        let tAll = 9, tEr = 9;
        for (const t of r.teeth) {
          const v = toothDist(t, x, y, z);
          if (v < tAll) tAll = v;
          if (t.gum && v < tEr) tEr = v;
        }
        const cr = r.crest(x, z), W = r.W(x, y), ends = (Math.abs(x - xm) - xh);
        const wob = 0.18 * vnoise(x * 0.45, y * 0.45, z * 0.45);
        // rounded alveolar crest and gently tapered sides, rounded ends
        let b = smax(Math.abs(z) - W + wob, y - cr, 2.2);
        b = smax(smax(b, ends, 2.5), r.y0 - y, 1.6);
        b = smax(b, -(tAll + 0.1), 0.3);
        if (r.boneCut) b = smax(b, -r.boneCut(x, y, z), 0.25);
        const thick = 1.2 + 0.5 * sstep(cr, cr - 4, y);
        let gm = smax(Math.abs(z) - (W + thick) + wob * 0.6, y - r.gumTop(x, z) - 0.9 * Math.exp(-Math.max(tEr, 0) / 0.8), 2.4);
        gm = smax(gm, ends + 0.3, 2.5);
        gm = smax(gm, cr - GUM_DEPTH - y, 1.2);
        gm = smax(gm, -(b + 0.05), 0.15);
        gm = smax(gm, -(tEr + 0.12), 0.5);
        if (r.gumCut) gm = smax(gm, -r.gumCut(x, y, z), 0.4);
        B[p] = b; Gm[p] = gm;
      }
    }
  }
  const Bs = combine(g, (p) => at(B, p)), Gs = combine(g, (p) => at(Gm, p));
  const fade = (x: number, y: number, floor: number, span = 3.2): number => sstep(xh + 0.4, xh - 4.6, Math.abs(x - xm)) * sstep(floor, floor + span, y);
  const gum = surfaceNets(g, Gs, (x, y, z, _nx, _ny, _nz, o) => {
    const top = r.gumTop(x, z), cr = r.crest(x, z);
    const marg = sstep(top - 2.0, top + 0.5, y), muc = sstep(cr - 1.6, cr - GUM_DEPTH, y);
    const st = 0.04 * vnoise(x * 2.2, y * 2.2, z * 2.2);
    const inf = r.inflamed ? marg : 0;
    o[0] = mix(mix(1.0, 0.95, marg), 0.86, muc) + st;
    o[1] = mix(mix(1.0, 0.8, marg), 0.58, muc) * mix(1, 0.62, inf) + st;
    o[2] = mix(mix(1.0, 0.84, marg), 0.7, muc) * mix(1, 0.7, inf) + st;
    o[3] = fade(x, y, cr - GUM_DEPTH + 0.6, 2.2);
  }, 4);
  const bone = surfaceNets(g, Bs, (x, y, _z, _nx, _ny, _nz, o) => {
    o[3] = fade(x, y, r.y0 + 0.2);
  }, 4);
  const inner = combine(g, (p) => at(Bs, p) + 0.75);
  return { gum, bone, cancellous: surfaceNets(g, inner), g, B: Bs, G: Gs };
}

// ------------------------------------------------------------------ scenes

const PERIO_ORDER: Kind[] = ["gum", "bone", "cancellous"];

/** Builds every part of a scene at a quality. */
export function buildScene(spec: SceneSpec, quality: Quality): Built {
  const q = QUALITY[quality];
  const parts: Part[] = [];
  const anchors: Anchor[] = [];
  const main = toothGrid(spec.type, q.tooth);
  const m = main.model;
  const cut = spec.cut === "x" ? (m.family === "anterior" ? 0 : 0.3) : m.family === "anterior" ? 0.5 * m.size : spec.type === "u6" || spec.type === "u7" || spec.type === "u8" || spec.type === "pu4" || spec.type === "pu5" ? 1.9 * m.size : 0;
  const carvers: Carver[] = [];
  let boneCut: Ridge["boneCut"] = null, gumCut: Ridge["gumCut"] = null;
  const cuts: ((x: number, y: number, z: number) => number)[] = [], gcuts: typeof cuts = [];
  const fieldsFor: { part: Part["name"]; fields: Partial<Record<Kind, Field>>; g: Grid; off: Vec3; rz: number }[] = [];
  const cejMax = m.cej(m.halfMD, 0), cejMid = m.cej(0, m.halfBL);
  let x0 = -Math.max(m.halfMD + 5.5, m.family === "anterior" ? 6.8 : 8.5), x1 = -x0, y0 = Math.min(...m.apexes.map((a) => a[1])) - 3.4;
  let crest = (x: number, z: number): number => {
    const c = m.cej(clamp(x, -m.halfMD, m.halfMD), z) - 1.7;
    return c + 0.9 * Math.exp(-(((Math.abs(x) - m.halfMD - 0.6) / 1.8) ** 2));
  };
  const papilla = (x: number): number => Math.exp(-(((Math.abs(x) - m.halfMD - 0.4) / 1.5) ** 2));
  const soft = (x: number, z: number): number => z * (1 - 0.65 * sstep(m.halfMD - 1, m.halfMD + 1.5, Math.abs(x)));
  let gumTop = (x: number, z: number): number => m.cej(clamp(x, -m.halfMD, m.halfMD), soft(x, z)) + 0.9 + (spec.gumInflamed ? 0.45 : 0) + (cejMax - cejMid + 1.2) * 0.5 * papilla(x);
  let W = (x: number, y: number): number => {
    let w = m.halfBL + 0.9 + 0.1 * Math.max(0, crest(x, 0) - y);
    for (const a of m.apexes) w += 0.45 * Math.exp(-(((x - a[0]) / 1.8) ** 2)) * sstep(a[1] - 2, a[1] + 4, y) * (a[2] >= 0 ? 1 : 0.4);
    return w;
  };
  let crownTarget: Vec3 = [0, m.crownTop - 1.5, 0];
  let wisdomPress: { c: Vec3 } | null = null;
  const lift = spec.lift ? 7 : 0;

  if (spec.site === "tooth") {
    const t = toothLayers(main, { spec });
    parts.push({ name: "tooth", position: [0, lift, 0], rz: lift ? 0.12 : 0, layers: t.layers });
    fieldsFor.push({ part: "tooth", fields: t.fields, g: main.g, off: [0, 0, 0], rz: 0 });
    carvers.push({ tg: main, at: [0, 0, 0], rz: 0, gum: true });
    if (lift) {
      const sk = (x: number, y: number, z: number): number => -sample(main.g, main.f.S, x, y, z) + 0.05;
      cuts.push((x, y, z) => -sk(x, y, z));
      gcuts.push((x, y, z) => sample(main.g, main.f.S, x, y, z) - 0.15);
    }
  } else if (spec.site === "socket" || spec.site === "healed" || spec.site === "implant") {
    const sock = spec.site === "socket";
    crest = (x: number, z: number): number => cejMid - 1.9 - (sock ? 0 : 0.7 * Math.exp(-((x / (m.halfMD + 1)) ** 2))) + 0.6 * papilla(x) - 0.05 * z * z * 0;
    gumTop = (x: number, z: number): number => crest(x, z) + (sock ? 1.6 : 2.4) + 0.8 * papilla(x);
    if (sock) {
      const S = main.f.S;
      cuts.push((x, y, z) => sample(main.g, S, x, y, z) - 0.06);
      gcuts.push((x, y, z) => sample(main.g, S, x, y, z) - 0.25);
      const clot = fill(main.g, (_x, y, _z, p) => Math.max(at(S, p) + 0.12, y - (cejMid - 1.6)));
      const mesh = surfaceNets(main.g, clot, aoColor(main.g, clot));
      parts.push({ name: "tooth", position: [0, 0, 0], rz: 0, layers: [{ kind: "clot", mesh, enter: "fade", label: "Healing socket" }] });
    }
    if (spec.site === "implant") {
      const R = Math.min(2.1, Math.max(1.6, m.halfMD * 0.42)), top = crest(0, 0) + 0.2, len = Math.min(11.5, Math.abs(y0) - 3);
      const pitch = 0.85;
      const fixture = (x: number, y: number, z: number): number => {
        const rr = Math.hypot(x, z), ph = Math.atan2(z, x) / (2 * Math.PI) + y / pitch, tri = Math.abs(ph - Math.floor(ph) - 0.5) * 2;
        const taper = R * (1 - 0.18 * sstep(top - len * 0.55, top - len, y));
        const thread = y < top - 0.8 && y > top - len + 0.6 ? 0.3 * (tri - 0.5) : 0;
        return smax(smax(rr - taper - thread, y - top, 0.15), top - len - y + taper * 0.7 * (1 - Math.min(1, rr / taper)), 0.9);
      };
      const ig = makeGrid([-R - 1, top - len - 1, -R - 1], [R + 1, top + 1, R + 1], q.tooth * 0.75);
      const Fi = fill(ig, fixture);
      const layers: Layer[] = [{ kind: "implant", mesh: surfaceNets(ig, Fi, aoColor(ig, Fi)), enter: "screw", label: "Implant" }];
      cuts.push((x, y, z) => fixture(x, y, z) - 0.02);
      if (spec.implant >= 2) {
        const gt = gumTop(0, 0) + 0.2, at2 = gt + (spec.implant >= 3 ? 1.6 : 2.8);
        const ab = (x: number, y: number, z: number): number => {
          const rr = Math.hypot(x / (m.halfMD * 0.5 > R ? 1.15 : 1), z), ry = mix(R * 1.02, R * 0.78, sstep(top, at2, y)) + 0.35 * sstep(top + 0.3, gt, y) * (1 - sstep(gt, gt + 0.8, y));
          return smax(smax(rr - ry, y - at2, 0.4), top - y, 0.1);
        };
        const ag = makeGrid([-R - 2, top - 0.5, -R - 2], [R + 2, at2 + 0.8, R + 2], q.tooth * 0.75);
        const Fa = fill(ag, ab);
        layers.push({ kind: "abutment", mesh: surfaceNets(ag, Fa, aoColor(ag, Fa)), enter: "drop", label: "Abutment" });
        gcuts.push((x, y, z) => ab(x, y, z) - 0.05);
      }
      if (spec.implant >= 3) {
        const S = main.f.S, gt = gumTop(0, 0);
        const Cr = fill(main.g, (x, y, z, p) => smax(at(S, p) - 0.04, Math.max(gt - 0.4, m.cej(x, z) - 0.6) - y + 0.25 * Math.max(0, Math.hypot(x, z) - R * 1.2) * 0, 0.5));
        layers.push({ kind: "crown", look: spec.crownLook, mesh: surfaceNets(main.g, Cr, aoColor(main.g, Cr)), enter: "drop", label: "Crown" });
      }
      parts.push({ name: "implant", position: [0, 0, 0], rz: 0, layers });
      if (spec.implant < 3) crownTarget = [0, top + 1.5, 0];
    } else crownTarget = [0, crest(0, 0) + 1, 0];
  } else {
    // wisdom tooth next to its mesial neighbour
    const w = spec.wisdom;
    if (!w) throw new Error("real-teeth-3d: wisdom scene without position");
    const nb = toothGrid(w.neighbor, q.tooth * 1.18), wt = toothGrid(spec.type, q.tooth * 1.18);
    const X7 = nb.model.halfMD + 0.6;
    const ANG: Record<string, number> = { vertical: 0, mesioangular: -42, distoangular: 28, horizontal: -88 };
    const phi = ((ANG[w.angulation] ?? 0) * Math.PI) / 180, co = Math.cos(phi), si = Math.sin(phi);
    const surf = surfaceNets(wt.g, wt.f.S).position, pts: Vec3[] = [];
    for (let i = 0; i < surf.length; i += 12) {
      const px = at(surf, i), py = at(surf, i + 1);
      if (w.eruption !== "erupted" && py < Math.min(...wt.model.apexes.map((a) => a[1])) * 0.55) continue;
      pts.push([px * co - py * si, px * si + py * co, at(surf, i + 2)]);
    }
    const ymax = Math.max(...pts.map((p) => p[1]));
    const nTop = nb.model.crownTop;
    const target = w.eruption === "erupted" ? nTop - 0.3 : w.eruption === "partial" ? nTop - 3.6 : w.eruption === "impacted" ? -2.1 : -4.6;
    const ty = target - ymax;
    const pressing = w.eruption !== "erupted" && (w.angulation === "mesioangular" || w.angulation === "horizontal");
    const gap = pressing ? -0.25 : w.angulation === "distoangular" ? 1.4 : 0.4;
    const minS = (tx: number): number => {
      let mn = 99;
      for (const p of pts) { const v = sample(nb.g, nb.f.S, p[0] + tx - X7, p[1] + ty, p[2]); if (v < mn) mn = v; }
      return mn;
    };
    let lo = X7 - 30, hi = X7 - 2;
    for (let it = 0; it < 22; it++) { const mid = (lo + hi) / 2; if (minS(mid) > gap) lo = mid; else hi = mid; }
    const tx = lo;
    const wc: Carver = { tg: wt, at: [tx, ty, 0], rz: phi, gum: w.eruption === "erupted" || w.eruption === "partial", lift };
    const nc: Carver = { tg: nb, at: [X7, 0, 0], rz: 0, gum: true };
    const shortRoots = w.eruption === "impacted" || w.eruption === "unerupted";
    // pressure: one smooth patch on the neighbour around the contact
    let extra: ToothOpts["extra"];
    if (pressing) {
      let best = 99, c: Vec3 = [0, 0, 0];
      forBox(nb.g, nb.model.bmin, nb.model.bmax, (p, x, y, z) => {
        const s0 = at(nb.f.S, p);
        if (s0 > 0.3 || s0 < -1.2) return;
        const d = toothDist(wc, x + X7, y, z);
        if (d < best) { best = d; c = [x, y, z]; }
      });
      wisdomPress = { c };
      extra = (x, y, z, o2) => {
        const dd = Math.hypot(x - c[0], y - c[1], z - c[2]), k = (1 - sstep(0.6, 2.6, dd)) * 0.85;
        o2[0] = mix(at(o2, 0), 1.0, k); o2[1] = mix(at(o2, 1), 0.3, k); o2[2] = mix(at(o2, 2), 0.27, k);
      };
    }
    const n7 = toothLayers(nb, { spec, plain: true, ...(extra ? { extra } : {}) });
    if (wisdomPress) {
      const c = wisdomPress.c;
      const pz = fill(nb.g, (x, y, z, p) => Math.max(at(nb.f.D, p), Math.hypot(x - c[0], y - c[1], z - c[2]) - 1.7));
      n7.layers.push({ kind: "pressure", mesh: surfaceNets(nb.g, pz), capOnly: true });
      n7.fields.pressure = pz;
      anchors.push({ text: `Pressing on ${w.neighbor.replace(/\D/g, "")}`, p: c, part: "neighbor", warn: true });
    }
    const w8 = toothLayers(wt, { spec, shortRoots });
    parts.push({ name: "neighbor", position: [X7, 0, 0], rz: 0, layers: n7.layers });
    parts.push({ name: "tooth", position: [tx, ty + lift, 0], rz: phi, layers: w8.layers });
    fieldsFor.push({ part: "tooth", fields: w8.fields, g: wt.g, off: [tx, ty + lift, 0], rz: phi });
    fieldsFor.push({ part: "neighbor", fields: n7.fields, g: nb.g, off: [X7, 0, 0], rz: 0 });
    carvers.length = 0;
    carvers.push(nc, wc);
    if (lift) cuts.push((x, y, z) => toothDist({ ...wc, lift: 0 }, x, y, z) - 0.05);
    const xw = tx, erupted = w.eruption === "erupted";
    const nm = nb.model;
    const ramus = (x: number): number => 2.4 * sstep(xw - 3, xw - 12, x);
    crest = (x: number, z: number): number => nm.cej(clamp(x - X7, -nm.halfMD, nm.halfMD), z) - 1.7 + 0.9 * Math.exp(-(((Math.abs(x - X7) - nm.halfMD - 0.6) / 1.8) ** 2)) * (x > X7 ? 1 : 0.5) + ramus(x);
    gumTop = (x: number, z: number): number => {
      let d = Math.abs(x - X7);
      if (erupted) d = Math.min(d, Math.abs(x - xw));
      return nm.cej(clamp(x - X7, -nm.halfMD, nm.halfMD), z) + 0.9 + 0.8 * sstep(nm.halfMD - 0.6, nm.halfMD + 1.6, d) + ramus(x) + (w.eruption === "partial" ? -0.6 * Math.exp(-(((x - xw) / 3) ** 2)) : 0);
    };
    const lowest = Math.min(...pts.map((p) => p[1] + ty), ...nm.apexes.map((a) => a[1]));
    x0 = Math.min(xw - 7, X7 - 12); x1 = X7 + nm.halfMD + 4.5; y0 = lowest - 4.2;
    W = (x: number, y: number): number => Math.max(nm.halfBL, wt.model.halfBL) + 1.0 + 0.1 * Math.max(0, crest(x, 0) - y);
    crownTarget = [(xw + X7) / 2, Math.max(target - 3, -1), 0];
  }
  // lesion at the root tip: a halo of infection and the bone it has dissolved
  if (spec.infection && (spec.site === "tooth" || spec.site === "wisdom")) {
    const big = spec.infection === "abscess", r = (big ? 2.4 : 1.8) * Math.max(0.75, m.size);
    const tips = big ? m.apexes : m.apexes.slice(0, 1), n = tips.length;
    // one lesion around the root tips (an ellipsoid spanning them), not a ball per root
    const ac: Vec3 = [tips.reduce((a, t) => a + t[0], 0) / n, tips.reduce((a, t) => a + t[1], 0) / n, tips.reduce((a, t) => a + t[2], 0) / n];
    const spanX = Math.max(...tips.map((t) => Math.abs(t[0] - ac[0]))), spanZ = Math.max(...tips.map((t) => Math.abs(t[2] - ac[2])));
    const apexes: Vec3[] = [ac];
    const off = spec.site === "wisdom" ? (parts.find((p) => p.name === "tooth")?.position ?? [0, 0, 0]) : [0, lift, 0];
    const rz = spec.site === "wisdom" ? (parts.find((p) => p.name === "tooth")?.rz ?? 0) : 0;
    const halo = (x: number, y: number, z: number): number => {
      let d = 9;
      for (const a of apexes) d = Math.min(d, (Math.hypot((x - a[0]) / (r + spanX), (y - a[1] + r * 0.45) / (r * 1.05), (z - a[2]) / (r * 0.9 + spanZ)) - 1) * r);
      return d + 0.3 * vnoise(x * 0.8, y * 0.8, z * 0.8);
    };
    const b0 = main.model.bmin, hg = makeGrid([b0[0] - 1, b0[1] - r - 1, b0[2] - 1], main.model.bmax, q.tooth);
    const Hf = fill(hg, (x, y, z) => Math.max(halo(x, y, z), -sample(main.g, main.f.S, x, y, z) + 0.05));
    const tp = parts.find((p) => p.name === "tooth");
    tp?.layers.push({ kind: "abscess", mesh: surfaceNets(hg, Hf), label: big ? "Abscess" : "Infection" });
    const co = Math.cos(rz), si = Math.sin(rz);
    cuts.push((x, y, z) => {
      const dx = x - (off[0] ?? 0), dy = y - (off[1] ?? 0);
      return halo(dx * co + dy * si, -dx * si + dy * co, z) - 0.15;
    });
    const ff = fieldsFor.find((f) => f.part === "tooth");
    if (ff) ff.fields.abscess = Hf;
    anchors.push({ text: big ? "Abscess" : "Infection", p: [apexes[0]?.[0] ?? 0, (apexes[0]?.[1] ?? 0) - r * 0.45, apexes[0]?.[2] ?? 0], part: "tooth", warn: true });
  }
  if (cuts.length) boneCut = (x, y, z) => Math.min(...cuts.map((c) => c(x, y, z)));
  if (gcuts.length) gumCut = (x, y, z) => Math.min(...gcuts.map((c) => c(x, y, z)));
  const ridge = buildRidge({
    x0, x1, y0, ytop: Math.max(...[x0, 0, x1].map((x) => gumTop(x, 0))) + 3, W, crest, gumTop, teeth: carvers, boneCut, gumCut,
    inflamed: spec.gumInflamed,
  }, spec.site === "wisdom" ? q.perio * 1.15 : q.perio);
  parts.unshift({
    name: "perio", position: [0, 0, 0], rz: 0, layers: [
      { kind: "gum", mesh: ridge.gum, label: "Gum" }, { kind: "bone", mesh: ridge.bone, label: "Bone" }, { kind: "cancellous", mesh: ridge.cancellous, capOnly: true },
    ],
  });
  // inside-view label points: the most interior point of each visible cut region
  const plane = (lx: number, ly: number, cz: number): Vec3 => (spec.cut === "x" ? [cz, ly, lx] : [lx, ly, cz]);
  const perioF: Partial<Record<Kind, Field>> = { gum: ridge.G, bone: ridge.B };
  const sources: { part: Part["name"]; kind: Kind; get: (x: number, y: number, z: number) => number }[] = [];
  for (const k of PERIO_ORDER) { const F = perioF[k]; if (F) sources.push({ part: "perio", kind: k, get: (x, y, z) => sample(ridge.g, F, x, y, z) }); }
  for (const fs of fieldsFor) {
    const co = Math.cos(fs.rz), si = Math.sin(fs.rz);
    for (const k of KIND_ORDER) {
      const F = fs.fields[k];
      if (!F || PERIO_ORDER.includes(k)) continue;
      sources.push({ part: fs.part, kind: k, get: (x, y, z) => { const dx = x - fs.off[0], dy = y - fs.off[1]; return sample(fs.g, F, dx * co + dy * si, -dx * si + dy * co, z - fs.off[2]); } });
    }
  }
  sources.sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
  const labelled = new Map<Kind, string>();
  for (const p of parts) for (const l of p.layers) if (l.label && !labelled.has(l.kind)) labelled.set(l.kind, l.label);
  const hx = spec.cut === "x" ? [-W(0, 0) - 1, W(0, 0) + 1] : [x0, x1];
  const step = 0.3;
  for (const [si2, src] of sources.entries()) {
    const text = labelled.get(src.kind);
    if (!text || src.kind === "decaySoft") continue;
    const ownPart = src.part;
    let best = -1, bp: Vec3 | null = null;
    for (let ly = y0; ly < gumTop(0, 0) + 2; ly += step) for (let lx = hx[0] ?? 0; lx < (hx[1] ?? 0); lx += step) {
      const p = plane(lx, ly, cut);
      const v = -src.get(p[0], p[1], p[2]);
      if (v < 0.25) continue;
      let sc = v;
      for (let j = si2 + 1; j < sources.length && sc > best; j++) sc = Math.min(sc, sources[j]?.get(p[0], p[1], p[2]) ?? 9);
      if (sc > best) { best = sc; bp = p; }
    }
    if (bp && best > 0.2) {
      const fs = fieldsFor.find((f) => f.part === ownPart);
      let lp: Vec3 = bp;
      if (fs) { const co = Math.cos(fs.rz), si = Math.sin(fs.rz), dx = bp[0] - fs.off[0], dy = bp[1] - fs.off[1]; lp = [dx * co + dy * si, -dx * si + dy * co, bp[2] - fs.off[2]]; }
      anchors.push({ text, p: lp, part: ownPart });
    }
  }
  let tris = 0;
  for (const p of parts) for (const l of p.layers) if (!l.capOnly) tris += l.mesh.tris;
  const ytop = gumTop(0, 0) + 1;
  return {
    parts, cut, tris, insideAnchors: anchors, crown: crownTarget,
    focusY: spec.site === "tooth" && !spec.infection ? m.cej(0, m.halfBL) - 0.62 * (m.cej(0, m.halfBL) - Math.min(...m.apexes.map((a) => a[1]))) : y0 + 1,
    min: [spec.site === "wisdom" ? x0 + 1.5 : -m.halfMD - 3.4, y0 + 1, -W(0, y0) - 1.5], max: [spec.site === "wisdom" ? x1 - 1.5 : m.halfMD + 3.4, Math.max(ytop, m.crownTop + 0.5 + lift, spec.implant >= 2 ? gumTop(0, 0) + 4 : -99), W(0, y0) + 1.5],
  };
}

/** Tooth types the module can draw (every 2D kit type). */
export const toothTypeList = (): ToothType[] => ["u1", "u2", "u3", "u4", "u5", "u6", "u7", "u8", "l1", "l2", "l3", "l4", "l5", "l6", "l7", "l8", "pu1", "pu2", "pu3", "pu4", "pu5", "pl1", "pl2", "pl3", "pl4", "pl5"];
