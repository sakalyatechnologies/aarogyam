// Renderers for a resolved Scene: an SVG string (also used by the React wrapper's markup) and a
// canvas 2D painter using Path2D with the same `d` strings (§1.12 m3).
import type { Matrix, ResolvedGradient, ResolvedPaint, Scene, SceneNode } from "./types.js";

const n = (v: number) => String(Math.round(v * 1000) / 1000);
const mat = (m: Matrix) => `matrix(${m.map(n).join(" ")})`;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);

export interface SvgStringOptions {
  /** Prefix for gradient and clip ids; give each SVG on a page its own. */
  idPrefix?: string;
  title?: string;
  /** Label colour (CSS). */
  labelColor?: string;
}

function gradientSvg(g: ResolvedGradient, id: string): string {
  const stops = g.spec.s.map((s, i) => `<stop offset="${n(s[0])}" stop-color="${g.colors[i] ?? "#000"}"/>`).join("");
  if (g.spec.t === "l") {
    return `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${n(g.spec.x1)}" y1="${n(g.spec.y1)}" x2="${n(g.spec.x2)}" y2="${n(g.spec.y2)}">${stops}</linearGradient>`;
  }
  const { cx, cy, r, sy } = g.spec;
  const tf = sy !== undefined && sy !== 1 ? ` gradientTransform="translate(${n(cx)} ${n(cy)}) scale(1 ${n(sy)}) translate(${n(-cx)} ${n(-cy)})"` : "";
  return `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}"${tf}>${stops}</radialGradient>`;
}

/** Attributes of one node's path element (shared by the SVG string and the React wrapper). */
export function pathAttrs(node: SceneNode, pre: string): Record<string, string> {
  const ref = (p: ResolvedPaint | undefined) => (p === undefined ? "none" : "color" in p ? p.color : `url(#${pre}${p.gradient})`);
  const a: Record<string, string> = { d: node.d, fill: ref(node.fill) };
  if (node.stroke) {
    a.stroke = ref(node.stroke);
    a["stroke-width"] = n(node.width ?? 1);
    a["stroke-linecap"] = "round";
    a["stroke-linejoin"] = "round";
  }
  if (node.opacity !== undefined) a.opacity = n(node.opacity);
  if (node.dash) a["stroke-dasharray"] = node.dash.map(n).join(" ");
  if (node.rule) a["fill-rule"] = node.rule;
  if (node.m) a.transform = mat(node.m);
  return a;
}

export function sceneToSvg(scene: Scene, opts: SvgStringOptions = {}): string {
  const pre = opts.idPrefix ?? "ma-";
  const defs = scene.gradients.map((g) => gradientSvg(g, pre + g.id)).join("") +
    Object.entries(scene.clips).map(([id, c]) => `<clipPath id="${pre}${id}" clipPathUnits="userSpaceOnUse"><path d="${c.d}"/></clipPath>`).join("");
  const body = scene.nodes.map((node) => {
    const attrs = Object.entries(pathAttrs(node, pre)).map(([k, v]) => `${k}="${esc(v)}"`).join(" ");
    let el = `<path ${attrs}/>`;
    if (node.clip !== undefined) el = `<g clip-path="url(#${pre}${node.clip})">${el}</g>`;
    if (node.group) el = `<g transform="${mat(node.group)}">${el}</g>`;
    return el;
  }).join("");
  const [x, y, w, h] = scene.box;
  const labels = scene.labels.map((l) => `<text x="${n(l.x)}" y="${n(l.y)}" text-anchor="${l.anchor ?? "middle"}" font-size="${n(Math.max(5, w * 0.075))}" font-weight="700" fill="${opts.labelColor ?? "#1E5E52"}" stroke="#fff" stroke-width="${n(w * 0.018)}" paint-order="stroke" font-family="system-ui,sans-serif">${esc(l.text)}</text>`).join("");
  const outer = scene.outer ? ` transform="${mat(scene.outer)}"` : "";
  const title = opts.title === undefined ? "" : `<title>${esc(opts.title)}</title>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${n(x)} ${n(y)} ${n(w)} ${n(h)}" role="img">${title}<defs>${defs}</defs><g${outer}>${body}</g>${labels}</svg>`;
}

/** A Path2D, or a stand-in in tests. */
export interface PathLike {
  addPath(path: PathLike, transform?: DOMMatrix2DInit): void;
}

/** The parts of the canvas API the painter needs (a real CanvasRenderingContext2D satisfies it). */
export interface Canvas2D {
  save(): void;
  restore(): void;
  transform(a: number, b: number, c: number, d: number, e: number, f: number): void;
  clip(path: PathLike, rule?: CanvasFillRule): void;
  fill(path: PathLike, rule?: CanvasFillRule): void;
  stroke(path: PathLike): void;
  setLineDash(segments: number[]): void;
  createLinearGradient(x0: number, y0: number, x1: number, y1: number): CanvasGradient;
  createRadialGradient(x0: number, y0: number, r0: number, x1: number, y1: number, r1: number): CanvasGradient;
  fillText(text: string, x: number, y: number): void;
  strokeText(text: string, x: number, y: number): void;
  fillStyle: string | CanvasGradient | CanvasPattern;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  lineCap: CanvasLineCap;
  lineJoin: CanvasLineJoin;
  globalAlpha: number;
  font: string;
  textAlign: CanvasTextAlign;
}

export interface CanvasDrawOptions {
  /** Pixels per scene unit; the scene's box is drawn from (0, 0). */
  scale: number;
  labelColor?: string;
  /** Path2D constructor (injectable for tests, or cached by a caller drawing many frames). */
  makePath?: (d: string) => PathLike;
  /** Multiplies every node's opacity (a fading scene in the video story). */
  alpha?: number;
}

/**
 * Paints a scene with Path2D. Radial gradients with a vertical scale are drawn by scaling the
 * context and pre-transforming the path by the inverse, so geometry stays put.
 */
export function drawScene(ctx: Canvas2D, scene: Scene, opts: CanvasDrawOptions): void {
  const make = opts.makePath ?? ((d: string): PathLike => new Path2D(d));
  const grads = new Map(scene.gradients.map((g) => [g.id, g]));
  const [bx, by] = scene.box;
  ctx.save();
  ctx.transform(opts.scale, 0, 0, opts.scale, -bx * opts.scale, -by * opts.scale);
  if (scene.outer) ctx.transform(...scene.outer);
  for (const node of scene.nodes) {
    ctx.save();
    if (node.group) ctx.transform(...node.group);
    if (node.clip !== undefined) {
      const c = scene.clips[node.clip];
      if (c) ctx.clip(make(c.d));
    }
    if (node.m) ctx.transform(...node.m);
    ctx.globalAlpha = (node.opacity ?? 1) * (opts.alpha ?? 1);
    const path = make(node.d);
    const style = (p: ResolvedPaint) => {
      if ("color" in p) return { style: p.color };
      const g = grads.get(p.gradient);
      if (!g) return { style: "#000" };
      const spec = g.spec;
      const cg = spec.t === "l" ? ctx.createLinearGradient(spec.x1, spec.y1, spec.x2, spec.y2) : ctx.createRadialGradient(spec.cx, spec.cy, 0, spec.cx, spec.cy, spec.r);
      spec.s.forEach((s, i) => { cg.addColorStop(Math.min(1, Math.max(0, s[0])), g.colors[i] ?? "#000"); });
      const sy = spec.t === "r" ? (spec.sy ?? 1) : 1;
      return { style: cg, sy, cy: spec.t === "r" ? spec.cy : 0 };
    };
    if (node.fill) {
      const s = style(node.fill);
      ctx.fillStyle = s.style;
      if (s.sy !== undefined && s.sy !== 1) {
        ctx.save();
        ctx.transform(1, 0, 0, s.sy, 0, s.cy * (1 - s.sy));
        const p2 = make("");
        p2.addPath(path, { a: 1, b: 0, c: 0, d: 1 / s.sy, e: 0, f: -s.cy * (1 - s.sy) / s.sy });
        ctx.fill(p2, node.rule ?? "nonzero");
        ctx.restore();
      } else {
        ctx.fill(path, node.rule ?? "nonzero");
      }
    }
    if (node.stroke) {
      ctx.strokeStyle = style(node.stroke).style;
      ctx.lineWidth = node.width ?? 1;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.setLineDash(node.dash ?? []);
      ctx.stroke(path);
    }
    ctx.restore();
  }
  ctx.restore();
  if (scene.labels.length) {
    const [, , w] = scene.box;
    ctx.save();
    ctx.fillStyle = opts.labelColor ?? "#1E5E52";
    ctx.font = `700 ${String(Math.max(5, w * 0.075) * opts.scale)}px system-ui, sans-serif`;
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = w * 0.018 * opts.scale;
    for (const l of scene.labels) {
      ctx.textAlign = l.anchor === "start" ? "left" : l.anchor === "end" ? "right" : "center";
      ctx.strokeText(l.text, (l.x - bx) * opts.scale, (l.y - by) * opts.scale);
      ctx.fillText(l.text, (l.x - bx) * opts.scale, (l.y - by) * opts.scale);
    }
    ctx.restore();
  }
}
