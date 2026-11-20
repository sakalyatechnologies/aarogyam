// Geometry and style helpers shared by the mouth-art generators.
// Coordinates: 100x200 box per tooth view, 6.2 units = 1 mm, crown up, mesial on the right.
export const MM = 6.2;
export const CEJ = 82;

export const r1 = (v) => {
  const r = Math.round(v * 10) / 10;
  return Object.is(r, -0) ? 0 : r;
};
export const fp = (p) => `${r1(p[0])} ${r1(p[1])}`;
export const corner = (p) => [p[0], p[1], 'c'];
export const noC = (p) => [p[0], p[1]];
export const rev = (a) => a.slice().reverse();
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const ss = (a, b, t) => {
  const x = clamp((t - a) / (b - a || 1), 0, 1);
  return x * x * (3 - 2 * x);
};

// Catmull-Rom -> cubic Bezier segments. A point [x, y, 'c'] is a corner.
export function bez(pts, closed = true, k = 1) {
  const n = pts.length;
  const P = (i) => (closed ? pts[(i + n) % n] : pts[Math.max(0, Math.min(n - 1, i))]);
  const segs = [];
  const m = closed ? n : n - 1;
  for (let i = 0; i < m; i++) {
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
    const c1 = p1[2] === 'c' ? [p1[0] + (p2[0] - p1[0]) * 0.3, p1[1] + (p2[1] - p1[1]) * 0.3]
      : [p1[0] + ((p2[0] - p0[0]) / 6) * k, p1[1] + ((p2[1] - p0[1]) / 6) * k];
    const c2 = p2[2] === 'c' ? [p2[0] + (p1[0] - p2[0]) * 0.3, p2[1] + (p1[1] - p2[1]) * 0.3]
      : [p2[0] - ((p3[0] - p1[0]) / 6) * k, p2[1] - ((p3[1] - p1[1]) / 6) * k];
    segs.push([p1, c1, c2, p2]);
  }
  return segs;
}
export function smooth(pts, closed = true) {
  const s = bez(pts, closed);
  let d = `M${fp(s[0][0])}`;
  for (const [, c1, c2, p2] of s) d += `C${fp(c1)} ${fp(c2)} ${fp(p2)}`;
  return closed ? d + 'Z' : d;
}
export const line = (pts) => smooth(pts, false);
export const poly = (pts) => 'M' + pts.map(fp).join('L') + 'Z';
export const pline = (pts) => 'M' + pts.map(fp).join('L');
export function ellipse(cx, cy, rx, ry) {
  const k = 0.5523, a = rx * k, b = ry * k;
  return `M${fp([cx + rx, cy])}C${fp([cx + rx, cy + b])} ${fp([cx + a, cy + ry])} ${fp([cx, cy + ry])}` +
    `C${fp([cx - a, cy + ry])} ${fp([cx - rx, cy + b])} ${fp([cx - rx, cy])}` +
    `C${fp([cx - rx, cy - b])} ${fp([cx - a, cy - ry])} ${fp([cx, cy - ry])}` +
    `C${fp([cx + a, cy - ry])} ${fp([cx + rx, cy - b])} ${fp([cx + rx, cy])}Z`;
}
// Dense polyline along the smoothed curve (for ray hits and offsets).
export function sample(pts, closed = true, n = 6) {
  const out = [];
  for (const [p1, c1, c2, p2] of bez(pts, closed)) {
    for (let i = 0; i < n; i++) {
      const t = i / n, u = 1 - t;
      out.push([u * u * u * p1[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * p2[0],
        u * u * u * p1[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * p2[1]]);
    }
  }
  if (!closed) out.push(noC(pts.at(-1)));
  return out;
}
// Smallest t > 0 with o + t*dir on the polyline (closed or open), or Infinity.
export function rayHit(o, dir, pl, closed = true) {
  let best = Infinity;
  const n = pl.length, m = closed ? n : n - 1;
  for (let i = 0; i < m; i++) {
    const a = pl[i], b = pl[(i + 1) % n];
    const ex = b[0] - a[0], ey = b[1] - a[1];
    const den = dir[0] * ey - dir[1] * ex;
    if (Math.abs(den) < 1e-9) continue;
    const ax = a[0] - o[0], ay = a[1] - o[1];
    const t = (ax * ey - ay * ex) / den, u = (ax * dir[1] - ay * dir[0]) / den;
    if (t > 1e-6 && u >= 0 && u <= 1 && t < best) best = t;
  }
  return best;
}
export const norm = (v) => {
  const l = Math.hypot(v[0], v[1]) || 1;
  return [v[0] / l, v[1] / l];
};
// Offset each point toward `toward` (a point inside the shape) by dist(i, p).
export function offsetIn(pts, toward, dist) {
  return pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    let nx = -(b[1] - a[1]), ny = b[0] - a[0];
    [nx, ny] = norm([nx, ny]);
    if (nx * (toward[0] - p[0]) + ny * (toward[1] - p[1]) < 0) { nx = -nx; ny = -ny; }
    const d = dist(i, p);
    return [p[0] + nx * d, p[1] + ny * d];
  });
}
// A rounded band of half-width hw around an open polyline.
export function capsule(pts, hw) {
  const L = [], R = [];
  pts.forEach((p, i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const [nx, ny] = norm([-(b[1] - a[1]), b[0] - a[0]]);
    L.push([p[0] + nx * hw, p[1] + ny * hw]);
    R.push([p[0] - nx * hw, p[1] - ny * hw]);
  });
  const t0 = norm([pts[0][0] - pts[1][0], pts[0][1] - pts[1][1]]);
  const n = pts.length;
  const t1 = norm([pts[n - 1][0] - pts[n - 2][0], pts[n - 1][1] - pts[n - 2][1]]);
  return smooth([[pts[0][0] + t0[0] * hw, pts[0][1] + t0[1] * hw], ...L, [pts[n - 1][0] + t1[0] * hw, pts[n - 1][1] + t1[1] * hw], ...rev(R)]);
}
// Deterministic irregular blob.
export function blob(cx, cy, rx, ry, seed = 1, jit = 0.18, rot = 0) {
  let s = seed * 9301 + 49297;
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  const pts = [];
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2, j = 1 + (rnd() - 0.5) * 2 * jit;
    const x = Math.cos(a) * rx * j, y = Math.sin(a) * ry * j;
    pts.push([cx + x * Math.cos(rot) - y * Math.sin(rot), cy + x * Math.sin(rot) + y * Math.cos(rot)]);
  }
  return smooth(pts);
}
export function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- style ----------
// Paint strings: "g:<id>" gradient, a token name (mixed from the shade), a colour name, or "#hex".
export const lin = (id, x1, y1, x2, y2, stops) => ({ id, t: 'l', x1: r1(x1), y1: r1(y1), x2: r1(x2), y2: r1(y2), s: stops.map(stopOf) });
export const rad = (id, cx, cy, r, stops, sy) => {
  const g = { id, t: 'r', cx: r1(cx), cy: r1(cy), r: r1(r), s: stops.map(stopOf) };
  if (sy && sy !== 1) g.sy = +sy.toFixed(2);
  return g;
};
function stopOf([o, p, a]) {
  return a === undefined || a === 1 ? [o, p] : [o, p, +a.toFixed(2)];
}
export const glow = (id, cx, cy, r, op, sy, col = 'white') => rad(id, cx, cy, r, [[0, col, op], [0.45, col, op * 0.45], [1, col, 0]], sy);
export function L(n, d, f, o = {}) {
  const l = { n, d };
  if (f) l.f = f;
  if (o.s) { l.s = o.s; l.w = o.w ?? 1; }
  if (o.op !== undefined) l.o = o.op;
  if (o.clip) l.c = o.clip;
  if (o.above) l.above = o.above;
  if (o.at) l.at = o.at;
  if (o.dash) l.dash = o.dash;
  if (o.mv) l.mv = o.mv;
  if (o.tr) l.tr = o.tr;
  if (o.rule) l.rule = o.rule;
  return l;
}

// Rewrites an absolute M/L/C/Z path as relative commands with short numbers (exact: deltas are
// taken between rounded absolute points, so nothing drifts).
const fmt = (v) => {
  const r = Math.round(v * 10) / 10;
  if (Object.is(r, -0) || r === 0) return '0';
  return String(r).replace(/^(-?)0\./, '$1.');
};
function joinNums(nums) {
  let out = '';
  nums.forEach((n, i) => {
    const s = fmt(n);
    if (i === 0) out = s;
    else {
      const prev = out;
      const needsSep = !(s.startsWith('-') || (s.startsWith('.') && /\.\d*$/.test(prev.split(/[ -]/).pop() ?? '')));
      out += (needsSep ? ' ' : '') + s;
    }
  });
  return out;
}
export function compactPath(d) {
  if (typeof d !== 'string' || !/^M-?[\d.]/.test(d)) return d;
  const toks = d.match(/[MLCZ]|-?\d*\.?\d+/g);
  let i = 0, cx = 0, cy = 0, sx = 0, sy = 0, out = '', first = true;
  const num = () => Math.round(parseFloat(toks[i++]) * 10) / 10;
  while (i < toks.length) {
    const c = toks[i++];
    if (c === 'Z') { out += 'z'; cx = sx; cy = sy; continue; }
    const n = c === 'C' ? 3 : 1;
    const rel = [];
    for (let k = 0; k < n; k++) { const x = num(), y = num(); rel.push(x - cx, y - cy); if (k === n - 1) { cx = x; cy = y; } }
    if (c === 'M') { sx = cx; sy = cy; out += (first ? 'M' : 'm') + joinNums(first ? [cx, cy] : rel); first = false; }
    else out += (c === 'C' ? 'c' : 'l') + joinNums(rel);
    // repeated numbers in C triples stay relative to the segment start, per the SVG spec
  }
  return out;
}
