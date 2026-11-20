// Signed distance fields on regular grids, meshed with surface nets (ported from the approved
// teeth3d prototype). Pure numeric code: no three.js, so it runs in tests and could move to a worker.

export type Vec3 = [number, number, number];

export const clamp = (x: number, a: number, b: number): number => (x < a ? a : x > b ? b : x);
export const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
export const sstep = (a: number, b: number, x: number): number => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
export const smin = (a: number, b: number, k: number): number => {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
};
export const smax = (a: number, b: number, k: number): number => -smin(-a, -b, k);

/** Monotone cubic profile through (ys[i], vs[i]). */
export function prof(ys: readonly number[], vs: readonly number[]): (y: number) => number {
  const n = ys.length;
  const Y = Float64Array.from(ys), V = Float64Array.from(vs), m = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.max(i - 1, 0), b = Math.min(i + 1, n - 1);
    m[i] = (at(V, b) - at(V, a)) / (at(Y, b) - at(Y, a));
  }
  return (y) => {
    if (y <= at(Y, 0)) return at(V, 0);
    if (y >= at(Y, n - 1)) return at(V, n - 1);
    let i = 0;
    while (y > at(Y, i + 1)) i++;
    const y0 = at(Y, i), h = at(Y, i + 1) - y0, t = (y - y0) / h, t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * at(V, i) + (t3 - 2 * t2 + t) * h * at(m, i) + (-2 * t3 + 3 * t2) * at(V, i + 1) + (t3 - t2) * h * at(m, i + 1);
  };
}

/** Typed-array read without `undefined` (indices are always in range in this module). */
export const at = (a: ArrayLike<number>, i: number): number => a[i] ?? 0;

function hash3(i: number, j: number, k: number): number {
  let h = Math.imul(i, 374761393) ^ Math.imul(j, 668265263) ^ Math.imul(k, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}
/** Value noise in [-1, 1]. */
export function vnoise(x: number, y: number, z: number): number {
  const i = Math.floor(x), j = Math.floor(y), k = Math.floor(z), fx = x - i, fy = y - j, fz = z - k;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz);
  return mix(
    mix(mix(hash3(i, j, k), hash3(i + 1, j, k), u), mix(hash3(i, j + 1, k), hash3(i + 1, j + 1, k), u), v),
    mix(mix(hash3(i, j, k + 1), hash3(i + 1, j, k + 1), u), mix(hash3(i, j + 1, k + 1), hash3(i + 1, j + 1, k + 1), u), v),
    w,
  ) * 2 - 1;
}
/** Tapered capsule from a (radius ra) to b (radius rb). */
export function capT(x: number, y: number, z: number, a: Vec3, b: Vec3, ra: number, rb: number): number {
  const bx = b[0] - a[0], by = b[1] - a[1], bz = b[2] - a[2], px = x - a[0], py = y - a[1], pz = z - a[2];
  const t = clamp((px * bx + py * by + pz * bz) / (bx * bx + by * by + bz * bz), 0, 1);
  const dx = px - bx * t, dy = py - by * t, dz = pz - bz * t;
  return Math.sqrt(dx * dx + dy * dy + dz * dz) - mix(ra, rb, t);
}
/** Rounded box centred at c with half extents b and corner radius r. */
export function rbox(x: number, y: number, z: number, c: Vec3, b: Vec3, r: number): number {
  const qx = Math.abs(x - c[0]) - b[0] + r, qy = Math.abs(y - c[1]) - b[1] + r, qz = Math.abs(z - c[2]) - b[2] + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0) - r;
}

export interface Grid {
  nx: number;
  ny: number;
  nz: number;
  n: number;
  ox: number;
  oy: number;
  oz: number;
  h: number;
}
export type Field = Float32Array;

export function makeGrid(min: Vec3, max: Vec3, h: number): Grid {
  const nx = Math.ceil((max[0] - min[0]) / h) + 1, ny = Math.ceil((max[1] - min[1]) / h) + 1, nz = Math.ceil((max[2] - min[2]) / h) + 1;
  return { nx, ny, nz, n: nx * ny * nz, ox: min[0], oy: min[1], oz: min[2], h };
}
/** Forces the grid border outside, so every surface closes. */
export function sealBorder(g: Grid, F: Field): Field {
  const { nx, ny, nz } = g, v = g.h;
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    if (i && j && k && i < nx - 1 && j < ny - 1 && k < nz - 1) continue;
    const p = i + nx * (j + ny * k);
    if (at(F, p) < v) F[p] = v;
  }
  return F;
}
/** Evaluates fn at every node (sealed). */
export function fill(g: Grid, fn: (x: number, y: number, z: number, p: number) => number): Field {
  const F = new Float32Array(g.n);
  for (let k = 0, p = 0; k < g.nz; k++) {
    const z = g.oz + k * g.h;
    for (let j = 0; j < g.ny; j++) {
      const y = g.oy + j * g.h;
      for (let i = 0; i < g.nx; i++, p++) F[p] = fn(g.ox + i * g.h, y, z, p);
    }
  }
  return sealBorder(g, F);
}
/** Combines fields node by node (sealed). */
export function combine(g: Grid, fn: (p: number) => number): Field {
  const F = new Float32Array(g.n);
  for (let p = 0; p < g.n; p++) F[p] = fn(p);
  return sealBorder(g, F);
}
/** Trilinear sample; outside the grid reads as far outside. */
export function sample(g: Grid, F: Field, x: number, y: number, z: number): number {
  const fx = (x - g.ox) / g.h, fy = (y - g.oy) / g.h, fz = (z - g.oz) / g.h;
  if (fx < 0 || fy < 0 || fz < 0 || fx > g.nx - 1 || fy > g.ny - 1 || fz > g.nz - 1) return 5;
  const i = Math.min(fx | 0, g.nx - 2), j = Math.min(fy | 0, g.ny - 2), k = Math.min(fz | 0, g.nz - 2);
  const tx = fx - i, ty = fy - j, tz = fz - k, sy = g.nx, sz = g.nx * g.ny, p = i + sy * j + sz * k;
  const c00 = mix(at(F, p), at(F, p + 1), tx), c10 = mix(at(F, p + sy), at(F, p + sy + 1), tx);
  const c01 = mix(at(F, p + sz), at(F, p + sz + 1), tx), c11 = mix(at(F, p + sy + sz), at(F, p + sy + sz + 1), tx);
  return mix(mix(c00, c10, ty), mix(c01, c11, ty), tz);
}
/** Iterates the nodes inside a box: cb(index, x, y, z). */
export function forBox(g: Grid, bmin: Vec3, bmax: Vec3, cb: (p: number, x: number, y: number, z: number) => void): void {
  const i0 = Math.max(0, Math.floor((bmin[0] - g.ox) / g.h)), i1 = Math.min(g.nx - 1, Math.ceil((bmax[0] - g.ox) / g.h));
  const j0 = Math.max(0, Math.floor((bmin[1] - g.oy) / g.h)), j1 = Math.min(g.ny - 1, Math.ceil((bmax[1] - g.oy) / g.h));
  const k0 = Math.max(0, Math.floor((bmin[2] - g.oz) / g.h)), k1 = Math.min(g.nz - 1, Math.ceil((bmax[2] - g.oz) / g.h));
  for (let k = k0; k <= k1; k++) for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++)
    cb(i + g.nx * (j + g.ny * k), g.ox + i * g.h, g.oy + j * g.h, g.oz + k * g.h);
}

const _gc = new Float64Array(3), _gr = new Float64Array(4);
function nodeGrad(g: Grid, F: Field, i: number, j: number, k: number): void {
  const sy = g.nx, sz = g.nx * g.ny, p = i + sy * j + sz * k, c = at(F, p);
  _gc[0] = (i < g.nx - 1 ? at(F, p + 1) : c) - (i > 0 ? at(F, p - 1) : c);
  _gc[1] = (j < g.ny - 1 ? at(F, p + sy) : c) - (j > 0 ? at(F, p - sy) : c);
  _gc[2] = (k < g.nz - 1 ? at(F, p + sz) : c) - (k > 0 ? at(F, p - sz) : c);
}
/** Value and smooth gradient (trilinear of node central differences): [v, gx, gy, gz]. */
function sampleVG(g: Grid, F: Field, x: number, y: number, z: number): Float64Array {
  const fx = clamp((x - g.ox) / g.h, 0, g.nx - 1.0001), fy = clamp((y - g.oy) / g.h, 0, g.ny - 1.0001), fz = clamp((z - g.oz) / g.h, 0, g.nz - 1.0001);
  const i = fx | 0, j = fy | 0, k = fz | 0, tx = fx - i, ty = fy - j, tz = fz - k;
  const sy = g.nx, sz = g.nx * g.ny, p = i + sy * j + sz * k;
  let v = 0, gx = 0, gy = 0, gz = 0;
  for (let b = 0; b < 8; b++) {
    const dx = b & 1, dy = (b >> 1) & 1, dz = (b >> 2) & 1;
    const w = (dx ? tx : 1 - tx) * (dy ? ty : 1 - ty) * (dz ? tz : 1 - tz);
    v += w * at(F, p + dx + dy * sy + dz * sz);
    nodeGrad(g, F, i + dx, j + dy, k + dz);
    gx += w * at(_gc, 0); gy += w * at(_gc, 1); gz += w * at(_gc, 2);
  }
  _gr[0] = v; _gr[1] = gx / (2 * g.h); _gr[2] = gy / (2 * g.h); _gr[3] = gz / (2 * g.h);
  return _gr;
}

/** A triangle mesh as plain arrays (three-free). `color` has `colorSize` floats per vertex. */
export interface MeshData {
  position: Float32Array;
  normal: Float32Array;
  index: Uint16Array | Uint32Array;
  color?: Float32Array;
  colorSize?: 3 | 4;
  tris: number;
}
/** Per-vertex colour: writes rgb (and alpha when the mesh has 4 channels) into out. */
export type ColorFn = (x: number, y: number, z: number, nx: number, ny: number, nz: number, out: Float64Array) => void;

const EDGES = [0, 1, 0, 2, 0, 4, 1, 3, 1, 5, 2, 3, 2, 6, 3, 7, 4, 5, 4, 6, 5, 7, 6, 7];
let cellBuf = new Int32Array(0);

/** Surface nets of the zero level set, vertices projected onto the surface, smooth normals. */
export function surfaceNets(g: Grid, F: Field, colorFn?: ColorFn, colorSize: 3 | 4 = 3): MeshData {
  const { nx, ny, nz, ox, oy, oz, h } = g, sy = nx, sz = nx * ny, cx = nx - 1, cy = ny - 1, cz = nz - 1;
  if (cellBuf.length < cx * cy * cz) cellBuf = new Int32Array(cx * cy * cz);
  const cell = cellBuf, pos: number[] = [], cv = new Float64Array(8);
  let nv = 0;
  for (let k = 0; k < cz; k++) for (let j = 0; j < cy; j++) {
    let p = j * sy + k * sz, ci = (j + k * cy) * cx;
    for (let i = 0; i < cx; i++, p++, ci++) {
      let mask = 0;
      for (let b = 0; b < 8; b++) {
        const v = at(F, p + (b & 1) + ((b >> 1) & 1) * sy + ((b >> 2) & 1) * sz);
        cv[b] = v;
        if (v < 0) mask |= 1 << b;
      }
      if (mask === 0 || mask === 255) { cell[ci] = -1; continue; }
      let ax = 0, ay = 0, az = 0, cnt = 0;
      for (let e = 0; e < 24; e += 2) {
        const a = at(EDGES, e), b = at(EDGES, e + 1), va = at(cv, a), vb = at(cv, b);
        if ((va < 0) !== (vb < 0)) {
          const t = va / (va - vb);
          ax += (a & 1) + ((b & 1) - (a & 1)) * t;
          ay += ((a >> 1) & 1) + (((b >> 1) & 1) - ((a >> 1) & 1)) * t;
          az += ((a >> 2) & 1) + (((b >> 2) & 1) - ((a >> 2) & 1)) * t;
          cnt++;
        }
      }
      pos.push(ox + (i + ax / cnt) * h, oy + (j + ay / cnt) * h, oz + (k + az / cnt) * h);
      cell[ci] = nv++;
    }
  }
  const C = (i: number, j: number, k: number): number => at(cell, i + (j + k * cy) * cx);
  const P = new Float32Array(pos);
  const idx: number[] = [];
  const d2 = (a: number, b: number): number => (at(P, a * 3) - at(P, b * 3)) ** 2 + (at(P, a * 3 + 1) - at(P, b * 3 + 1)) ** 2 + (at(P, a * 3 + 2) - at(P, b * 3 + 2)) ** 2;
  const quad = (a: number, b0: number, c: number, d0: number, keep: boolean): void => {
    const b = keep ? b0 : d0, d = keep ? d0 : b0;
    if (d2(a, c) < d2(b, d)) idx.push(a, b, c, a, c, d);
    else idx.push(a, b, d, b, c, d);
  };
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const p = i + sy * j + sz * k, in0 = at(F, p) < 0;
    if (i < cx && j > 0 && k > 0 && j < cy && k < cz && (at(F, p + 1) < 0) !== in0) quad(C(i, j - 1, k - 1), C(i, j, k - 1), C(i, j, k), C(i, j - 1, k), in0);
    if (j < cy && i > 0 && k > 0 && i < cx && k < cz && (at(F, p + sy) < 0) !== in0) quad(C(i - 1, j, k - 1), C(i - 1, j, k), C(i, j, k), C(i, j, k - 1), in0);
    if (k < cz && i > 0 && j > 0 && i < cx && j < cy && (at(F, p + sz) < 0) !== in0) quad(C(i - 1, j - 1, k), C(i, j - 1, k), C(i, j, k), C(i - 1, j, k), in0);
  }
  const N = new Float32Array(P.length), maxStep = h * 0.6;
  for (let v = 0; v < nv; v++) {
    let x = at(P, v * 3), y = at(P, v * 3 + 1), z = at(P, v * 3 + 2);
    for (let it = 0; it < 3; it++) {
      const r = sampleVG(g, F, x, y, z), gl = at(r, 1) ** 2 + at(r, 2) ** 2 + at(r, 3) ** 2;
      if (gl < 1e-10) break;
      const s = at(r, 0) / gl;
      let dx = s * at(r, 1), dy = s * at(r, 2), dz = s * at(r, 3);
      const m = Math.hypot(dx, dy, dz);
      if (m > maxStep) { dx *= maxStep / m; dy *= maxStep / m; dz *= maxStep / m; }
      x -= dx; y -= dy; z -= dz;
    }
    const r = sampleVG(g, F, x, y, z), l = Math.hypot(at(r, 1), at(r, 2), at(r, 3)) || 1;
    P[v * 3] = x; P[v * 3 + 1] = y; P[v * 3 + 2] = z;
    N[v * 3] = at(r, 1) / l; N[v * 3 + 1] = at(r, 2) / l; N[v * 3 + 2] = at(r, 3) / l;
  }
  const mesh: MeshData = { position: P, normal: N, index: nv > 65535 ? new Uint32Array(idx) : new Uint16Array(idx), tris: idx.length / 3 };
  if (colorFn) {
    const col = new Float32Array(nv * colorSize), out = new Float64Array(4);
    for (let v = 0; v < nv; v++) {
      out[0] = 1; out[1] = 1; out[2] = 1; out[3] = 1;
      colorFn(at(P, v * 3), at(P, v * 3 + 1), at(P, v * 3 + 2), at(N, v * 3), at(N, v * 3 + 1), at(N, v * 3 + 2), out);
      for (let c = 0; c < colorSize; c++) col[v * colorSize + c] = at(out, c);
    }
    mesh.color = col;
    mesh.colorSize = colorSize;
  }
  return mesh;
}

/** Ambient occlusion from a field: marches along the normal. */
export function aoAt(g: Grid, F: Field, x: number, y: number, z: number, nx: number, ny: number, nz: number): number {
  let occ = 0, w = 0.5;
  for (let i = 1; i <= 5; i++) {
    const d = 0.3 * i, v = sample(g, F, x + nx * d, y + ny * d, z + nz * d);
    occ += w * Math.max(0, d * 0.9 - v);
    w *= 0.62;
  }
  return clamp(1 - 2.0 * occ, 0.28, 1);
}
