// Procedural tooth generators: two families (posterior: premolars and molars; anterior: incisors and
// canines) driven by parameter tables, upper and lower, permanent and primary. Every tooth is built
// crown-up in millimetres, in the 2D kit's base orientation: mesial +x, buccal/labial +z, the
// cemento-enamel junction (CEJ) near y = 0. Upper teeth and the left side are mirrored at render time.
import type { ToothType } from "../mouth-art/types.js";
import { at, capT, clamp, combine, makeGrid, mix, prof, rbox, sample, smax, smin, sstep, vnoise, type Field, type Grid, type Vec3 } from "./sdf.js";

export interface ToothFields {
  /** Outer surface. */
  S: Field;
  /** Dentin (and root) surface. */
  D: Field;
  /** Pulp chamber and canals. */
  P: Field;
  /** Enamel cap (crown only). */
  E: Field;
}

export interface ToothModel {
  type: ToothType;
  family: "anterior" | "posterior";
  primary: boolean;
  bmin: Vec3;
  bmax: Vec3;
  /** Highest crown point (y). */
  crownTop: number;
  /** Crown half widths at the height of contour (mesio-distal, bucco-lingual). */
  halfMD: number;
  halfBL: number;
  /** Root tips. */
  apexes: Vec3[];
  /** Canal orifice height (root filling starts below it). */
  orificeY: number;
  /** Enamel thickness tint strength. */
  tint: number;
  /** Size relative to a permanent tooth (cavity sizes scale with it). */
  size: number;
  cej(x: number, z: number): number;
  /** Fissure stain 0..1 near the occlusal surface (posterior only). */
  fiss: ((x: number, y: number, z: number) => number) | null;
  /** Occlusal height field (posterior only), used for sealant. */
  occl: ((x: number, z: number) => number) | null;
  /** Access cavity for a root canal. */
  access(x: number, y: number, z: number): number;
  /** Crown preparation reduction depth. */
  crownRed(x: number, y: number, z: number): number;
  /** Extra enamel colour (incisal translucency, cervical warmth). */
  grad: ((x: number, y: number, z: number, o: Float64Array) => void) | null;
  fields(g: Grid): ToothFields;
}

/** Builds the four fields from per-row functions (rows are cached per y). */
function buildFields<R>(g: Grid, row: (y: number) => R, S: (x: number, z: number, c: R) => number, thick: (x: number, z: number, c: R) => number,
  pulp: (x: number, z: number, c: R) => number, cej: (x: number, z: number) => number, y0: (c: R) => number): ToothFields {
  const rows: R[] = [];
  for (let j = 0; j < g.ny; j++) rows.push(row(g.oy + j * g.h));
  const s = new Float32Array(g.n), d = new Float32Array(g.n), p = new Float32Array(g.n), e = new Float32Array(g.n);
  for (let k = 0, q = 0; k < g.nz; k++) {
    const z = g.oz + k * g.h;
    for (let j = 0; j < g.ny; j++) {
      const c = rows[j];
      if (c === undefined) continue;
      const y = y0(c);
      for (let i = 0; i < g.nx; i++, q++) {
        const x = g.ox + i * g.h, v = S(x, z, c);
        s[q] = v;
        d[q] = v + thick(x, z, c);
        e[q] = smax(v, cej(x, z) - 0.45 - y, 0.2);
        p[q] = pulp(x, z, c);
      }
    }
  }
  const seal = (F: Field): Field => combine(g, (q) => at(F, q));
  return { S: seal(s), D: seal(d), P: seal(p), E: seal(e) };
}

// ------------------------------------------------------------------ posterior family

interface Root { x0: number; z0?: number; zc?: number; c1: number; c2: number; top: number; apex: number; rx: number; rz: number; tx: number; tz: number; groove?: number }
interface Canal { root: number; top: number; rx: number; rz: number }
export interface PosteriorParams {
  ys: number[];
  ax: number[];
  bB: number[];
  bL: number[];
  /** [x, z, height]. */
  cusps: [number, number, number][];
  /** Marginal and oblique ridges [x0, z0, x1, z1, height]. */
  ridges: [number, number, number, number, number][];
  /** Vertical developmental grooves [side (+1 buccal), x, depth, start y]. */
  grooves: [number, number, number, number][];
  trunk: number;
  cejBase: number;
  cejAmp: number;
  hornMin: number;
  roots: Root[];
  canals: Canal[];
  ch: { c: Vec3; b: Vec3; r: number };
  enamel?: number;
}

const YS = [-4, -2, 0, 1.2, 2.5, 4, 5.5, 7, 8.4];

function makePosterior(type: ToothType, P: PosteriorParams, primary: boolean): ToothModel {
  const ax = prof(P.ys, P.ax), bB = prof(P.ys, P.bB), bL = prof(P.ys, P.bL);
  const en = P.enamel ?? 1, n = 2.6, inv = 1 / n, r0 = 1.3, sl = 0.9, kap = 4.5;
  const halfMD = Math.max(...P.ax), halfBL = Math.max(...P.bB, ...P.bL);
  const sc = 4.45 / (P.ax[2] ?? 4.45);
  let G = 0, Gs = 0;
  const cxR = P.roots.map((R) => (y: number) => { const q = clamp((R.top - y) / (R.top - R.apex), 0, 1); return R.x0 + R.c1 * q + R.c2 * q * q; });
  const czR = P.roots.map((R) => (y: number) => { const q = clamp((R.top - y) / (R.top - R.apex), 0, 1); return (R.z0 ?? 0) + (R.zc ?? 0) * q * q; });
  interface Tube { cx: number; cz: number; rx: number; rz: number; g: number }
  const tube = (R: Root, y: number, cxf: (y: number) => number, czf: (y: number) => number): Tube | null => {
    const s = (R.top - y) / (R.top - R.apex);
    if (s < 0 || s > 1) return null;
    const q = s > 0.84 ? (s - 0.84) / 0.16 : 0, rf = Math.sqrt(Math.max(1 - q * q, 0.004));
    return { cx: cxf(y), cz: czf(y), rx: R.rx * (1 - R.tx * s) * rf, rz: R.rz * (1 - R.tz * s) * rf, g: R.groove ?? 0 };
  };
  const tubeF = (t: Tube | null, x: number, z: number): number => {
    if (!t) return 9;
    const dx = x - t.cx, dz = z - t.cz;
    let rx = t.rx;
    if (t.g) rx *= 1 - t.g * Math.exp(-(dz * dz) / (0.2 * t.rz * t.rz));
    return (Math.sqrt((dx / rx) ** 2 + (dz / t.rz) ** 2) - 1) * Math.min(rx, t.rz);
  };
  const canals = P.canals.map((c) => {
    const R = P.roots[c.root] ?? P.roots[0];
    return { root: { top: c.top, apex: (R?.apex ?? -12) + 0.6, rx: c.rx, rz: c.rz, tx: 0.6, tz: 0.7, x0: 0, c1: 0, c2: 0 }, cxf: cxR[c.root] ?? cxR[0] ?? (() => 0), czf: czR[c.root] ?? czR[0] ?? (() => 0) };
  });
  const top0 = P.ch.c[1] + P.ch.b[1];
  const horns = P.cusps.filter((c) => c[2] > P.hornMin).map((c): [Vec3, Vec3, number, number] => {
    const top = top0 + 0.7 + (c[2] - 7) * 0.8;
    return [[c[0] * 0.4, P.ch.c[1] + 0.5, c[1] * 0.12], [c[0] * 0.5, top, c[1] * 0.14], 0.8, 0.32];
  });
  function occl(x: number, z: number): number {
    let s = 0, h1 = -99, h2 = -99;
    const add = (hv: number): void => {
      s += Math.exp(kap * (hv - 7));
      if (hv > h1) { h2 = h1; h1 = hv; } else if (hv > h2) h2 = hv;
    };
    for (const c of P.cusps) {
      const dx = x - c[0], dz = z - c[1];
      add(c[2] - sl * (Math.sqrt(dx * dx + dz * dz + r0 * r0) - r0));
    }
    for (const r of P.ridges) {
      const ex = r[2] - r[0], ez = r[3] - r[1], t = clamp(((x - r[0]) * ex + (z - r[1]) * ez) / (ex * ex + ez * ez), 0, 1);
      const dx = x - r[0] - ex * t, dz = z - r[1] - ez * t;
      add(r[4] - 1.25 * (Math.sqrt(dx * dx + dz * dz + 0.36) - 0.6));
    }
    // V-shaped groove (sharp floor, soft shoulders) instead of a gaussian bead; wobble breaks the line
    const dh = Math.abs(h1 - h2) * (1 + 0.25 * vnoise(x * 1.3, 0.5, z * 1.3));
    G = Math.exp(-dh / 0.22);
    Gs = Math.exp(-((dh / 0.09) ** 2));
    return 7 + Math.log(s) / kap;
  }
  interface Row { y: number; ax: number; bB: number; bL: number; gf: number[]; roots: (Tube | null)[]; canals: (Tube | null)[] }
  const row = (y: number): Row => ({
    y, ax: ax(y), bB: bB(y), bL: bL(y), gf: P.grooves.map((g) => g[2] * sstep(g[3], g[3] + 2.2, y)),
    roots: P.roots.map((R, i) => tube(R, y, cxR[i] ?? (() => 0), czR[i] ?? (() => 0))),
    canals: canals.map((c) => tube(c.root, y, c.cxf, c.czf)),
  });
  function lateral(x: number, z: number, c: Row): number {
    const b = z > 0 ? c.bB : c.bL, u = Math.abs(x / c.ax), v = Math.abs(z / b);
    let f = (Math.pow(Math.pow(u, n) + Math.pow(v, n), inv) - 1) * Math.min(c.ax, b);
    P.grooves.forEach((g, i) => {
      const gf = c.gf[i] ?? 0;
      if (g[0] * z > 0 && gf > 0.001) { const d = (x - g[1]) / 0.6; f += gf * Math.exp(-d * d) * sstep(0.5, 0.85, v); }
    });
    return f;
  }
  function S(x: number, z: number, c: Row): number {
    const y = c.y;
    let f = lateral(x, z, c);
    if (y > 3) {
      const h = occl(x, z), inner = sstep(0.1, -1.3, f);
      f = smax(f, (y - h + G * 0.62 * inner) * 0.78, 0.7);
    }
    let body = smax(f, P.trunk - y, 0.9);
    for (const t of c.roots) if (t) body = smin(body, tubeF(t, x, z), 0.9);
    return body;
  }
  const cej = (x: number, z: number): number => {
    const u = (x / 4.45) * sc, v = z / 4.15, p = (u * u) / (u * u + v * v + 1e-6);
    return P.cejBase + P.cejAmp * p;
  };
  function thick(x: number, z: number, c: Row): number {
    const yc = c.y - cej(x, z), tp = en * (1.25 + 0.95 * sstep(4.6, 7.2, c.y));
    return -0.07 + (0.07 + tp) * sstep(-0.1, 2.4, yc);
  }
  function pulp(x: number, z: number, c: Row): number {
    const y = c.y;
    let f = rbox(x, y, z, P.ch.c, P.ch.b, P.ch.r);
    if (f > 3 && y > P.ch.c[1] + 3) return f;
    for (const hn of horns) f = smin(f, capT(x, y, z, hn[0], hn[1], hn[2], hn[3]), 0.7);
    for (const t of c.canals) if (t) f = smin(f, tubeF(t, x, z), 0.7);
    return f;
  }
  function fiss(x: number, y: number, z: number): number {
    if (y < 3.5) return 0;
    const h = occl(x, z);
    return Gs * sstep(-1.0, -0.15, y - h) * sstep(0.2, -1.0, lateral(x, z, row(y))) * (0.55 + 0.45 * vnoise(x * 0.9 + 7, y, z * 0.9));
  }
  const crownTop = Math.max(...P.cusps.map((c) => c[2]));
  const apexes = P.roots.map((R): Vec3 => [R.x0 + R.c1 + R.c2, R.apex, (R.z0 ?? 0) + (R.zc ?? 0)]);
  const minApex = Math.min(...P.roots.map((r) => r.apex));
  const zr = Math.max(halfBL, ...P.roots.map((r) => Math.abs((r.z0 ?? 0) + (r.zc ?? 0)) + r.rz));
  const accR = Math.min(1.45, halfMD * 0.32), accZ = Math.min(1.25, halfBL * 0.28);
  return {
    type, family: "posterior", primary, halfMD, halfBL, apexes, crownTop, tint: 0.35, size: halfMD / 5.3,
    bmin: [-halfMD - 1.6, minApex - 1.2, -zr - 1.6], bmax: [halfMD + 1.6, crownTop + 1.4, zr + 1.6],
    orificeY: -0.9, cej, occl, fiss,
    access: (x, y, z) => smax(capT(x, y, z, [0.1, crownTop + 2, 0], [0.1, 1.2, 0], accR, accR * 0.86), Math.abs(z) - accZ - 0.4 * accR, 0.4),
    crownRed: (x, y, z) => 0.45 + 1.0 * sstep(0, 1.2, y - cej(x, z) - 0.3) + 0.55 * sstep(crownTop - 2.6, crownTop - 0.2, y),
    grad: null,
    fields: (g) => buildFields(g, row, S, thick, pulp, cej, (c) => c.y),
  };
}

const P_L6: PosteriorParams = {
  ys: YS,
  ax: [4.15, 4.3, 4.45, 4.8, 5.3, 5.5, 5.25, 4.65, 4.0],
  bB: [3.9, 4.0, 4.15, 4.5, 4.85, 4.75, 4.25, 3.5, 2.9],
  bL: [3.8, 3.9, 4.05, 4.4, 4.7, 4.85, 4.6, 3.95, 3.3],
  cusps: [[2.9, 2.45, 7.1], [-0.6, 2.8, 6.95], [-3.7, 1.55, 6.5], [2.7, -2.6, 7.55], [-1.9, -2.7, 7.35]],
  ridges: [[4.0, 1.5, 4.0, -1.7, 6.25], [-4.35, 0.4, -3.6, -1.9, 5.95]],
  grooves: [[1, 0.95, 0.3, 3.4], [1, -2.3, 0.24, 3.9], [-1, 0.25, 0.26, 4.1]],
  trunk: -3.6, cejBase: -0.1, cejAmp: 0.7, hornMin: 6.7,
  roots: [{ x0: 2.45, c1: 0.35, c2: -1.2, top: 0.0, apex: -14.2, rx: 1.75, rz: 3.5, tx: 0.45, tz: 0.52, groove: 0.2 },
    { x0: -2.45, c1: -0.2, c2: -0.5, top: 0.0, apex: -13.3, rx: 1.8, rz: 3.25, tx: 0.45, tz: 0.48, groove: 0.08 }],
  canals: [{ root: 0, top: -0.3, rx: 0.42, rz: 1.3 }, { root: 1, top: -0.3, rx: 0.48, rz: 1.0 }],
  ch: { c: [0.1, 0.5, 0], b: [2.2, 1.25, 1.6], r: 0.9 },
};
const P_L7: PosteriorParams = {
  ys: YS,
  ax: [3.95, 4.1, 4.25, 4.6, 5.05, 5.25, 5.05, 4.5, 3.9],
  bB: [3.8, 3.9, 4.0, 4.35, 4.7, 4.6, 4.15, 3.5, 2.9],
  bL: [3.7, 3.8, 3.95, 4.3, 4.65, 4.85, 4.7, 4.2, 3.5],
  cusps: [[2.5, 2.35, 6.95], [-2.2, 2.45, 6.75], [2.45, -2.35, 7.25], [-2.2, -2.4, 7.05]],
  ridges: [[3.85, 1.4, 3.8, -1.6, 6.1], [-3.95, 1.3, -3.9, -1.5, 5.85]],
  grooves: [[1, 0.1, 0.28, 3.6], [-1, 0.1, 0.26, 4.0]],
  trunk: -3.8, cejBase: -0.1, cejAmp: 0.6, hornMin: 6.6,
  roots: [{ x0: 2.4, c1: 0.2, c2: -1.3, top: 0.0, apex: -13.4, rx: 1.4, rz: 3.35, tx: 0.42, tz: 0.52, groove: 0.18 },
    { x0: -2.4, c1: -0.2, c2: -0.8, top: 0.0, apex: -12.8, rx: 1.5, rz: 3.1, tx: 0.42, tz: 0.48, groove: 0.06 }],
  canals: [{ root: 0, top: -0.3, rx: 0.4, rz: 1.2 }, { root: 1, top: -0.3, rx: 0.45, rz: 0.95 }],
  ch: { c: [0, 0.45, 0], b: [2.0, 1.2, 1.5], r: 0.9 },
};
const P_L8: PosteriorParams = {
  ys: YS,
  ax: [3.6, 3.75, 3.9, 4.4, 4.75, 4.85, 4.65, 4.2, 3.6],
  bB: [3.6, 3.7, 3.8, 4.35, 4.55, 4.4, 4.0, 3.4, 2.8],
  bL: [3.5, 3.6, 3.7, 4.05, 4.35, 4.5, 4.35, 3.85, 3.2],
  cusps: [[2.2, 2.1, 6.4], [-1.7, 2.2, 6.2], [2.1, -2.1, 6.6], [-1.6, -2.15, 6.4], [-3.1, 0.1, 5.8]],
  ridges: [[3.5, 1.3, 3.45, -1.5, 5.7]],
  grooves: [[1, 0.3, 0.25, 3.4], [-1, 0.25, 0.22, 3.8]],
  trunk: -4.8, cejBase: -0.1, cejAmp: 0.5, hornMin: 6.1,
  roots: [{ x0: 1.4, c1: -0.2, c2: -1.5, top: 0.0, apex: -10.6, rx: 1.65, rz: 3.1, tx: 0.5, tz: 0.55, groove: 0.1 },
    { x0: -1.4, c1: -0.6, c2: -1.0, top: 0.0, apex: -10.0, rx: 1.65, rz: 2.9, tx: 0.5, tz: 0.55, groove: 0.05 }],
  canals: [{ root: 0, top: -0.3, rx: 0.38, rz: 1.0 }, { root: 1, top: -0.3, rx: 0.4, rz: 0.9 }],
  ch: { c: [0, 0.4, 0], b: [1.8, 1.1, 1.35], r: 0.8 },
};
const P_U6: PosteriorParams = {
  ys: YS,
  ax: [4.2, 4.35, 4.5, 4.85, 5.2, 5.3, 5.05, 4.5, 3.8],
  bB: [4.3, 4.45, 4.6, 5.0, 5.35, 5.3, 4.85, 4.05, 3.2],
  bL: [4.4, 4.55, 4.7, 5.1, 5.45, 5.45, 5.05, 4.25, 3.35],
  cusps: [[2.5, 2.6, 7.2], [-2.4, 2.6, 6.9], [2.1, -2.3, 7.6], [-2.6, -2.5, 6.5]],
  ridges: [[4.2, 1.6, 4.1, -1.7, 6.2], [-4.1, 1.5, -4.0, -1.6, 5.9], [1.8, -1.9, -1.7, 2.0, 6.55]],
  grooves: [[1, 0.0, 0.28, 3.6], [-1, -1.2, 0.25, 4.0]],
  trunk: -3.4, cejBase: -0.1, cejAmp: 0.6, hornMin: 6.7,
  roots: [{ x0: 2.4, z0: 2.2, c1: 0.1, c2: -1.0, top: 0, apex: -12.6, rx: 1.5, rz: 2.0, tx: 0.45, tz: 0.5, groove: 0.15 },
    { x0: -2.5, z0: 2.2, c1: -0.1, c2: -0.4, top: 0, apex: -11.8, rx: 1.35, rz: 1.7, tx: 0.45, tz: 0.5 },
    { x0: 0, z0: -2.3, zc: -1.3, c1: 0, c2: 0, top: 0, apex: -13.4, rx: 1.95, rz: 1.8, tx: 0.5, tz: 0.5 }],
  canals: [{ root: 0, top: -0.3, rx: 0.4, rz: 0.95 }, { root: 1, top: -0.3, rx: 0.4, rz: 0.6 }, { root: 2, top: -0.3, rx: 0.6, rz: 0.55 }],
  ch: { c: [0, 0.5, 0], b: [2.3, 1.25, 2.0], r: 0.9 },
};
const P_U4: PosteriorParams = {
  ys: YS,
  ax: [2.5, 2.6, 2.75, 3.05, 3.4, 3.55, 3.35, 2.9, 2.3],
  bB: [3.6, 3.75, 3.9, 4.3, 4.6, 4.5, 4.0, 3.2, 2.4],
  bL: [3.4, 3.55, 3.7, 4.1, 4.4, 4.3, 3.8, 3.0, 2.2],
  cusps: [[0.15, 2.3, 7.6], [0.0, -2.2, 6.9]],
  ridges: [[2.9, 1.6, 2.9, -1.5, 6.3], [-2.9, 1.5, -2.9, -1.5, 6.2]],
  grooves: [],
  trunk: -2.5, cejBase: -0.1, cejAmp: 1.0, hornMin: 6.5,
  roots: [{ x0: 0, c1: 0, c2: -0.2, top: 0, apex: -7.5, rx: 2.0, rz: 3.5, tx: 0.2, tz: 0.15 },
    { x0: 0, z0: 1.75, c1: 0, c2: -0.5, top: -5, apex: -13.6, rx: 1.45, rz: 1.4, tx: 0.45, tz: 0.45 },
    { x0: 0, z0: -1.75, c1: 0, c2: -0.3, top: -5, apex: -13.0, rx: 1.4, rz: 1.35, tx: 0.45, tz: 0.45 }],
  canals: [{ root: 1, top: -0.3, rx: 0.35, rz: 0.4 }, { root: 2, top: -0.3, rx: 0.35, rz: 0.4 }],
  ch: { c: [0, 0.6, 0], b: [1.1, 1.4, 2.4], r: 0.8 },
};
const P_U5: PosteriorParams = {
  ...P_U4,
  cusps: [[0.1, 2.2, 7.3], [0.0, -2.2, 7.05]],
  roots: [{ x0: 0, c1: 0, c2: -0.6, top: 0, apex: -14, rx: 1.9, rz: 3.5, tx: 0.55, tz: 0.5, groove: 0.25 }],
  canals: [{ root: 0, top: -0.3, rx: 0.35, rz: 1.4 }],
};
const P_L4: PosteriorParams = {
  ys: YS,
  ax: [2.4, 2.5, 2.65, 2.95, 3.3, 3.5, 3.35, 2.95, 2.4],
  bB: [3.4, 3.5, 3.6, 3.95, 4.2, 4.0, 3.5, 2.8, 2.1],
  bL: [3.0, 3.1, 3.2, 3.5, 3.6, 3.3, 2.7, 2.0, 1.4],
  cusps: [[0.1, 1.4, 7.6], [0.0, -2.0, 5.6]],
  ridges: [[2.8, 1.2, 2.7, -1.4, 5.9], [-2.8, 1.2, -2.7, -1.4, 5.8]],
  grooves: [],
  trunk: -2.5, cejBase: -0.1, cejAmp: 0.9, hornMin: 6.8,
  roots: [{ x0: 0, c1: 0, c2: -0.5, top: 0, apex: -14, rx: 1.85, rz: 3.1, tx: 0.55, tz: 0.5, groove: 0.1 }],
  canals: [{ root: 0, top: -0.3, rx: 0.4, rz: 1.1 }],
  ch: { c: [0, 0.6, 0.3], b: [1.1, 1.4, 2.0], r: 0.8 },
};
const P_L5: PosteriorParams = {
  ...P_L4,
  ax: [2.6, 2.75, 2.9, 3.2, 3.6, 3.75, 3.6, 3.2, 2.6],
  bB: [3.5, 3.6, 3.75, 4.1, 4.35, 4.2, 3.75, 3.0, 2.3],
  bL: [3.4, 3.5, 3.6, 3.95, 4.2, 4.1, 3.7, 3.0, 2.3],
  cusps: [[0.1, 1.6, 7.3], [1.3, -2.0, 6.6], [-1.3, -2.1, 6.3]],
  ridges: [[3.1, 1.3, 3.0, -1.5, 6.0], [-3.1, 1.3, -3.0, -1.5, 5.9]],
  hornMin: 6.4,
  roots: [{ x0: 0, c1: 0, c2: -0.6, top: 0, apex: -14.5, rx: 1.95, rz: 3.3, tx: 0.55, tz: 0.5, groove: 0.1 }],
};

/** Scales a posterior table: s for crown widths, sy for crown height, sr for root length. */
function scaled(P: PosteriorParams, s: number, sy: number, sr: number, extra: Partial<PosteriorParams> = {}): PosteriorParams {
  const yv = (y: number): number => (y > 0 ? y * sy : y * sr);
  return {
    ...P,
    ys: P.ys.map(yv),
    ax: P.ax.map((v) => v * s), bB: P.bB.map((v) => v * s), bL: P.bL.map((v) => v * s),
    cusps: P.cusps.map(([x, z, h]) => [x * s, z * s, h * sy]),
    ridges: P.ridges.map(([a, b, c, d, h]) => [a * s, b * s, c * s, d * s, h * sy]),
    grooves: P.grooves.map(([sd, x, dp, y]) => [sd, x * s, dp * s, y * sy]),
    hornMin: P.hornMin * sy, trunk: P.trunk * sr,
    roots: P.roots.map((r) => ({ ...r, x0: r.x0 * s, z0: (r.z0 ?? 0) * s, c1: r.c1 * s, c2: r.c2 * s, top: yv(r.top), apex: r.apex * sr, rx: r.rx * s, rz: r.rz * s })),
    canals: P.canals.map((c) => ({ ...c, rx: c.rx * s, rz: c.rz * s })),
    ch: { c: [P.ch.c[0] * s, P.ch.c[1] * sy, P.ch.c[2] * s], b: [P.ch.b[0] * s, P.ch.b[1] * sy, P.ch.b[2] * s], r: P.ch.r * s },
    ...extra,
  };
}
/** Primary molar: smaller, lower crown, thin enamel, big pulp, short splayed roots. */
function primary(P: PosteriorParams, s: number): PosteriorParams {
  const q = scaled(P, s, 0.78, 0.6, { enamel: 0.55 });
  return {
    ...q,
    roots: q.roots.map((r) => ({ ...r, rx: r.rx * 0.72, rz: r.rz * 0.8, x0: r.x0 * 1.15, c2: Math.sign(r.x0) * 1.3 * s, top: Math.min(r.top, -0.6) })),
    ch: { ...q.ch, b: [q.ch.b[0] * 1.2, q.ch.b[1] * 1.15, q.ch.b[2] * 1.2] },
    hornMin: q.hornMin - 0.6,
  };
}

const POSTERIOR: Partial<Record<ToothType, PosteriorParams>> = {
  l6: P_L6, l7: P_L7, l8: P_L8, l4: P_L4, l5: P_L5, u4: P_U4, u5: P_U5, u6: P_U6,
  u7: scaled(P_U6, 0.93, 0.97, 0.95, { cusps: [[2.4, 2.4, 7.1], [-2.3, 2.4, 6.7], [2.0, -2.2, 7.4], [-2.4, -2.3, 5.9]] }),
  u8: scaled(P_U6, 0.86, 0.92, 0.8, { cusps: [[2.2, 2.2, 6.6], [-2.0, 2.2, 6.2], [1.9, -2.0, 6.8], [-2.1, -2.0, 5.5]] }),
  pl4: primary(P_L7, 0.74), pl5: primary(P_L6, 0.84), pu4: primary(P_U6, 0.7), pu5: primary(P_U6, 0.84),
};

// ------------------------------------------------------------------ anterior family

export interface AnteriorParams {
  /** Width, crown height, root length and thickness factors against an upper central incisor. */
  w: number;
  hc: number;
  hr: number;
  t: number;
  /** Canine cusp slope (0 = straight incisal edge). */
  cusp: number;
  /** Mesial and distal incisal corner radii. */
  rM: number;
  rD: number;
  /** Mamelon strength (young incisors). */
  mam: number;
}

function makeAnterior(type: ToothType, A: AnteriorParams, primaryTooth: boolean): ToothModel {
  const M = 1, ys = [-13.6, -11.5, -9, -6, -3, 0, 1.3, 3, 5, 7, 8.5, 9.6, 10.6];
  const AW = prof(ys, [1.05, 1.45, 2.05, 2.6, 3.05, 3.4, 3.5, 3.72, 4.05, 4.3, 4.38, 4.34, 4.25]);
  const ZL = prof(ys, [1.05, 1.45, 2.1, 2.7, 3.15, 3.5, 3.78, 3.75, 3.4, 2.85, 2.2, 1.6, 0.95]);
  const ZG = prof(ys, [1.05, 1.4, 2.0, 2.6, 3.05, 3.38, 3.68, 3.2, 2.0 + A.cusp * 0.9, 1.2 + A.cusp * 0.8, 0.75 + A.cusp * 0.4, 0.48, 0.28]);
  const pys = [-13.1, -11, -7, -3, 0, 2, 4, 5.4, 6.3];
  const PRX = prof(pys, [0.14, 0.28, 0.48, 0.7, 0.95, 1.5, 1.65, 1.4, 0.7]);
  const PRZ = prof(pys, [0.14, 0.28, 0.48, 0.68, 0.8, 0.72, 0.55, 0.4, 0.25]);
  const sm = Math.min(A.w, A.t);
  const ny = (y: number): number => (y > 0 ? y / A.hc : y / A.hr);
  interface Row { y: number; yy: number; a: number; zl: number; zg: number; fd: number; cx: number; lab: number; prx: number; prz: number; pcz: number }
  const row = (y: number): Row => {
    const yy = ny(y), s = yy < -11.6 ? (-11.6 - yy) / 2.05 : 0, rf = Math.sqrt(Math.max(1 - s * s, 0.004));
    return {
      y, yy, a: AW(yy) * rf, zl: ZL(yy) * rf, zg: ZG(yy) * rf,
      fd: 0.55 * (1 - A.cusp * 0.5) * sstep(2.4, 4.6, yy) * (1 - 0.7 * sstep(8.2, 10.4, yy)),
      cx: yy < 0 ? -M * 0.55 * Math.pow(clamp(-yy / 13.6, 0, 1), 2) : 0,
      lab: sstep(3, 9, yy), prx: PRX(yy), prz: PRZ(yy), pcz: 0.55 * sstep(0, 5, yy),
    };
  };
  const top = (xx: number): number => 10.6 - A.cusp * Math.abs(xx - 0.25) + A.mam * 0.26 * Math.cos((2 * Math.PI * xx) / 2.75) * sstep(3.9, 2.6, Math.abs(xx));
  function S(x: number, z: number, c: Row): number {
    const yy = c.yy, X = x / A.w, Z = z / A.t, xx = X - c.cx;
    let a = c.a, b: number;
    if (Z >= 0) b = c.zl;
    else {
      const u0 = clamp(xx / a, -1, 1);
      b = Math.max(c.zg - c.fd * (1 - u0 * u0), 0.12);
      a *= 1 - 0.14 * Math.min(1, -Z / Math.max(c.zg, 0.3));
    }
    const ne = Z >= 0 ? 2.0 : 2.4;
    let f = (Math.pow(Math.pow(Math.abs(xx / a), ne) + Math.pow(Math.abs(Z / b), ne), 1 / ne) - 1) * Math.min(a, b);
    // three labial lobes separated by shallow developmental depressions
    if (Z > 0 && c.lab > 0) f += 0.15 * c.lab * (1 - A.cusp) * (Math.exp(-(((xx - 1.45) / 0.55) ** 2)) + Math.exp(-(((xx + 1.45) / 0.55) ** 2)));
    const r = X * M > 0 ? A.rM : A.rD, qx = Math.abs(X) - (4.3 - r);
    const qy = (yy - (top(X) - r)) / Math.sqrt(1 + A.cusp * A.cusp);
    const ft = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
    f = smax(f, ft, 0.3);
    return Math.max(f, -13.66 - yy) * sm;
  }
  const cej = (x: number, z: number): number => {
    const u = x / A.w / 3.5, v = z / A.t / 3.4, p = (u * u) / (u * u + v * v + 1e-6);
    return (x * M > 0 ? 3.3 : 2.6) * Math.pow(p, 1.6) * A.hc;
  };
  const en = primaryTooth ? 0.6 : 1;
  function thick(x: number, z: number, c: Row): number {
    const yy = c.yy, yc = c.y - cej(x, z), base = mix(0.6, 0.95, sstep(-0.5, 1.0, z));
    const mam = Math.pow(0.5 + 0.5 * Math.cos((2 * Math.PI * x / A.w) / 2.7), 2) * sstep(7.4, 9.2, yy) * (A.mam > 0 ? 1 : 0.3);
    const tt = (base * sstep(-0.1, 2.8, yc) + 1.6 * sstep(7.6, 10.2, yy) - 0.9 * mam) * en;
    return -0.07 + (0.07 + tt) * sstep(-0.1, 1.0, yc);
  }
  const hornsI = [-1.2, 0, 1.2].map((x0): [Vec3, Vec3, number, number] => [[x0, 5.2, 0.5], [x0 * 1.1, 6.6 + (x0 * M > 0 ? 0.35 : 0) - (x0 === 0 ? 0.2 : 0) + A.cusp * (x0 === 0 ? 1.2 : -0.4), 0.55], 0.4, 0.2]);
  function pulp(x: number, z: number, c: Row): number {
    const yy = c.yy, X = x / A.w, Z = z / A.t;
    if (yy < -13.15 || yy > 8.2) return 9;
    let f = (Math.hypot((X - c.cx) / c.prx, (Z - c.pcz) / c.prz) - 1) * Math.min(c.prx, c.prz);
    f = smax(f, yy - 6.2 - A.cusp, 0.8);
    f = Math.max(f, -13.1 - yy);
    if (yy > 4.5) for (const hn of hornsI) f = smin(f, capT(X, yy, Z, hn[0], hn[1], hn[2], hn[3]), 0.5);
    return f * sm * (primaryTooth ? 1.25 : 1);
  }
  const crownTop = 10.6 * A.hc, rootY = -13.6 * A.hr;
  const halfMD = 4.38 * A.w, halfBL = 3.78 * A.t;
  return {
    type, family: "anterior", primary: primaryTooth, crownTop, halfMD, halfBL, tint: 1.0, size: A.w,
    bmin: [-halfMD - 1.0, rootY - 0.8, -halfBL - 0.9], bmax: [halfMD + 1.0, crownTop + 0.8, halfBL + 0.9],
    apexes: [[-0.55 * A.w, rootY + 0.3, 0]], orificeY: 0.8 * A.hc, cej, occl: null, fiss: null,
    access: (x, y, z) => {
      const X = x / A.w, Y = ny(y), Z = z / A.t;
      return smin(capT(X, Y, Z, [0, 6.2, -4.0], [0, 3.6, 0.45], 0.95, 0.8), capT(X, Y, Z, [0, 3.6, 0.45], [0, 0.6, 0.4], 0.8, 0.6), 0.4) * sm;
    },
    crownRed: (x, y, z) => 0.45 + 0.6 * sstep(0, 1.2, y - cej(x, z) - 0.3) + 0.9 * sstep(8.0, 10.4, ny(y)),
    grad: (x, y, z, o) => {
      // incisal translucency: blue-grey where enamel has no dentin behind it, a bright halo at the edge
      const yy = ny(y), inc = sstep(7.2, 10.2, yy) * (primaryTooth ? 0.5 : 1), cer = 1 - sstep(1.5, 5.5, yy);
      const mamel = A.mam * Math.pow(0.5 + 0.5 * Math.cos((2 * Math.PI * x / A.w) / 2.7), 2) * sstep(7.6, 9.4, yy) * (1 - sstep(9.6, 10.4, yy));
      const halo = sstep(10.0, 10.55, yy + A.cusp * Math.abs(x / A.w));
      o[0] = at(o, 0) * mix(1, 0.8, inc) * mix(1, 1.0, cer) * mix(1, 1.04, mamel) * mix(1, 1.12, halo);
      o[1] = at(o, 1) * mix(1, 0.86, inc) * mix(1, 0.95, cer) * mix(1, 1.04, mamel) * mix(1, 1.1, halo);
      o[2] = at(o, 2) * mix(1, 0.99, inc) * mix(1, 0.84, cer) * mix(1, 1.0, mamel) * mix(1, 1.06, halo);
    },
    fields: (g) => buildFields(g, row, S, thick, pulp, cej, (c) => c.y),
  };
}

const ANTERIOR: Partial<Record<ToothType, AnteriorParams>> = {
  u1: { w: 1, hc: 1, hr: 1, t: 1, cusp: 0, rM: 0.85, rD: 2.0, mam: 1 },
  u2: { w: 0.76, hc: 0.86, hr: 0.97, t: 0.9, cusp: 0, rM: 1.1, rD: 2.4, mam: 0.7 },
  u3: { w: 0.88, hc: 0.98, hr: 1.25, t: 1.16, cusp: 0.6, rM: 0.9, rD: 1.2, mam: 0 },
  l1: { w: 0.6, hc: 0.86, hr: 0.92, t: 0.86, cusp: 0, rM: 0.6, rD: 0.8, mam: 0.6 },
  l2: { w: 0.66, hc: 0.9, hr: 1.0, t: 0.9, cusp: 0, rM: 0.7, rD: 1.2, mam: 0.5 },
  l3: { w: 0.8, hc: 1.0, hr: 1.16, t: 1.08, cusp: 0.5, rM: 0.9, rD: 1.2, mam: 0 },
  pu1: { w: 0.76, hc: 0.58, hr: 0.72, t: 0.72, cusp: 0, rM: 1.0, rD: 1.6, mam: 0 },
  pu2: { w: 0.6, hc: 0.56, hr: 0.72, t: 0.66, cusp: 0, rM: 1.2, rD: 1.8, mam: 0 },
  pu3: { w: 0.74, hc: 0.66, hr: 0.9, t: 0.82, cusp: 0.6, rM: 1.0, rD: 1.2, mam: 0 },
  pl1: { w: 0.46, hc: 0.52, hr: 0.68, t: 0.6, cusp: 0, rM: 0.6, rD: 0.8, mam: 0 },
  pl2: { w: 0.52, hc: 0.56, hr: 0.72, t: 0.62, cusp: 0, rM: 0.8, rD: 1.2, mam: 0 },
  pl3: { w: 0.62, hc: 0.64, hr: 0.84, t: 0.76, cusp: 0.5, rM: 1.0, rD: 1.2, mam: 0 },
};

const cache = new Map<ToothType, ToothModel>();
/** The generator for a tooth type (cached). */
export function toothModel(type: ToothType): ToothModel {
  const hit = cache.get(type);
  if (hit) return hit;
  const isPrimary = type.startsWith("p");
  const pp = POSTERIOR[type], ap = ANTERIOR[type];
  const m = pp ? makePosterior(type, pp, isPrimary) : ap ? makeAnterior(type, ap, isPrimary) : makePosterior(type, P_L6, isPrimary);
  cache.set(type, m);
  return m;
}

/** Fields of a tooth on its own grid, cached per resolution. */
export interface ToothGrid { model: ToothModel; g: Grid; f: ToothFields }
const gridCache = new Map<string, ToothGrid>();
export function toothGrid(type: ToothType, h: number): ToothGrid {
  const key = `${type}@${String(h)}`;
  const hit = gridCache.get(key);
  if (hit) return hit;
  const model = toothModel(type);
  const g = makeGrid(model.bmin, model.bmax, h);
  const tg = { model, g, f: model.fields(g) };
  if (gridCache.size > 12) gridCache.clear();
  gridCache.set(key, tg);
  return tg;
}
/** Samples a tooth field at a local point. */
export const fieldAt = (t: ToothGrid, name: keyof ToothFields, x: number, y: number, z: number): number => sample(t.g, t.f[name], x, y, z);
