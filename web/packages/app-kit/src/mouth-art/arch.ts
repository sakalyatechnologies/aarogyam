// Overview layout: places each tooth's top view along an arch at its true mesiodistal width, so
// neighbours never overlap at any screen width (fixes the mock-up's overlapping lower milk teeth).
import { toothTypeOf } from "./loaders.js";
import type { ToothType } from "./types.js";

/** Mesiodistal crown widths in mm (top views are drawn at the same scale). */
export const TOOTH_WIDTH_MM: Record<ToothType, number> = {
  u1: 8.5, u2: 6.5, u3: 7.5, u4: 7, u5: 6.5, u6: 10, u7: 9, u8: 8.5,
  l1: 5, l2: 5.5, l3: 7, l4: 7, l5: 7, l6: 11, l7: 10.5, l8: 10,
  pu1: 6.5, pu2: 5.1, pu3: 7, pu4: 7.3, pu5: 8.2, pl1: 4.2, pl2: 4.1, pl3: 5, pl4: 7.7, pl5: 9.9,
};
/** Buccolingual depths in mm. */
export const TOOTH_DEPTH_MM: Record<ToothType, number> = {
  u1: 7, u2: 6, u3: 8, u4: 9, u5: 9, u6: 11, u7: 11, u8: 10,
  l1: 6, l2: 6.5, l3: 7.5, l4: 7.5, l5: 8, l6: 10.5, l7: 10, l8: 9.5,
  pu1: 5, pu2: 4.2, pu3: 7, pu4: 8.5, pu5: 10, pl1: 4, pl2: 4, pl3: 4.8, pl4: 7, pl5: 8.7,
};

export interface ArchSlot {
  fdi: number;
  type: ToothType;
  /** Centre in layout pixels. */
  x: number;
  y: number;
  /** Rotation in degrees (the tooth's top view, already flipped/mirrored for its quadrant). */
  angle: number;
  /** Drawn size in pixels. */
  w: number;
  h: number;
}

export interface ArchLayoutOptions {
  /** Layout width in px. */
  width: number;
  /** Gap between neighbours in mm. */
  gapMm?: number;
  /** Space between the two arches in px. */
  between?: number;
  /** Arch depth as a share of its half width (0.72 default; about 1 for the rounder U of the mouth view). */
  depth?: number;
}

/** Lays out the given FDI teeth (any mix of permanent and milk) as an upper and a lower arch. */
export function archLayout(fdis: number[], opts: ArchLayoutOptions): { slots: ArchSlot[]; height: number } {
  const gap = opts.gapMm ?? 0.6;
  const slots: ArchSlot[] = [];
  const arches = [
    { upper: true, quads: [1, 2, 5, 6] },
    { upper: false, quads: [4, 3, 8, 7] },
  ];
  let yOff = 0;
  let height = 0;
  const measured = arches.map(({ upper, quads }) => {
    const side = (right: boolean) => fdis
      .filter((f) => quads.includes(Math.floor(f / 10)) && [1, 4, 5, 8].includes(Math.floor(f / 10)) === right)
      .map((f) => ({ fdi: f, type: toothTypeOf(f) }))
      .filter((t): t is { fdi: number; type: ToothType } => t.type !== undefined)
      .sort((a, b) => (a.fdi % 10) - (b.fdi % 10));
    const r = side(true), l = side(false);
    const len = (s: { type: ToothType }[]) => s.reduce((a, t) => a + TOOTH_WIDTH_MM[t.type] + gap, 0);
    return { upper, r, l, half: Math.max(len(r), len(l), 1) };
  });
  const maxHalf = Math.max(...measured.map((m) => m.half));
  // half-ellipse arch: semi-axes chosen so the arc length of a quarter equals the longest side
  const shape = { a: 1, b: opts.depth ?? 0.72 };
  const quarter = arcLength(shape.a, shape.b, Math.PI / 2);
  const mmPerUnit = maxHalf / quarter;
  const depthMm = Math.max(...fdis.map((f) => { const t = toothTypeOf(f); return t ? TOOTH_DEPTH_MM[t] : 0; }));
  const pad = depthMm * 0.6;
  const px = opts.width / (2 * shape.a * mmPerUnit + 2 * pad);
  const archH = (shape.b * mmPerUnit + pad * 2) * px;
  for (const m of measured) {
    for (const [list, sgn] of [[m.r, -1], [m.l, 1]] as const) {
      let s = 0;
      for (const t of list) {
        const w = TOOTH_WIDTH_MM[t.type];
        const mid = (s + w / 2 + gap / 2) / mmPerUnit;
        s += w + gap;
        const th = thetaAt(shape.a, shape.b, mid);
        const ex = shape.a * Math.sin(th), ey = shape.b * Math.cos(th);
        const tx = shape.a * Math.cos(th), ty = -shape.b * Math.sin(th);
        const ang = (Math.atan2(ty, tx) * 180) / Math.PI;
        const x = opts.width / 2 + sgn * ex * mmPerUnit * px;
        const yUnit = m.upper ? (shape.b - ey) * mmPerUnit + pad : ey * mmPerUnit + pad;
        slots.push({
          fdi: t.fdi, type: t.type,
          x, y: yOff + yUnit * px,
          angle: m.upper ? sgn * -ang : sgn * ang,
          w: w * px, h: TOOTH_DEPTH_MM[t.type] * px,
        });
      }
    }
    yOff += archH + (opts.between ?? 24);
    height = yOff - (opts.between ?? 24);
  }
  return { slots, height };
}

function arcLength(a: number, b: number, theta: number): number {
  let s = 0;
  const n = 64;
  for (let i = 0; i < n; i++) {
    const t0 = (theta * i) / n, t1 = (theta * (i + 1)) / n;
    s += Math.hypot(a * (Math.sin(t1) - Math.sin(t0)), b * (Math.cos(t1) - Math.cos(t0)));
  }
  return s;
}
function thetaAt(a: number, b: number, s: number): number {
  let lo = 0, hi = Math.PI / 2;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (arcLength(a, b, mid) < s) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}
