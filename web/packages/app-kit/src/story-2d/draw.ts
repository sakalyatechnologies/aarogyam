// The frame function of the canvas 2D story (design §1.7): `drawFrame(ctx, story, t)` paints the
// frame at `t` ms and nothing else; same inputs, same calls. Every picture is the mouth-art kit's
// Path2D art (one source with the page); shapes are SVG path strings too, so a test can record them.
import { drawScene, type Canvas2D, type PathLike } from "../mouth-art/render.js";
import type { Scene } from "../mouth-art/types.js";
import { toothInfo, type Badge } from "../mouth-view/model.js";
import type { ArchTooth, PreparedStory } from "./prepare.js";
import type { Finding } from "./storyboard.js";
import { HEIGHT, sectionOf, stepOf, WIDTH, type Segment, type SectionName } from "./storyboard.js";

/** The canvas calls a frame needs; a CanvasRenderingContext2D (or an OffscreenCanvas one) has them. */
export interface StoryCtx extends Canvas2D {
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;
  translate(x: number, y: number): void;
  rotate(angle: number): void;
  scale(x: number, y: number): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  measureText(text: string): { width: number };
  textBaseline: CanvasTextBaseline;
}

export interface DrawOptions {
  /** Path2D constructor (tests pass a recorder). */
  makePath?: (d: string) => PathLike;
}

const C = {
  bg: "#f6f4ef", card: "#ffffff", text: "#1d2a26", muted: "#5c6b66", line: "#e4e0d6",
  brand: "#136650", brandSoft: "#e3f1ec", amber: "#9a5b00", amberSoft: "#fbf0dc", stage: "#f3efe8", stage2: "#ebe5da",
  found: "#7a4a1e", foundSoft: "#f3e6d6", slate: "#50606a", gum: "#f6e2df", nr: "#b9b0a2", nrFill: "rgba(255,255,255,0.45)",
} as const;
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", sans-serif';
const GLYPH = {
  check: "M-0.95 0.05L-0.25 0.75L1 -0.65",
  out: "M-0.7 0.7L0.75 -0.75M-0.15 -0.8H0.8V0.15",
  clock: "M0 -0.75V0L0.55 0.35",
  found: "M0 -0.8V0.25M0 0.75V0.8",
  calendar: "M-9 -6.5H9V9H-9ZM-9 -1.5H9M-4.5 -10V-4M4.5 -10V-4",
};

// ---------- drawing state ----------

interface D { ctx: StoryCtx; make: (d: string) => PathLike; alpha: number }

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const ease = (v: number) => { const x = clamp01(v); return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2; };
const easeOut = (v: number) => 1 - (1 - clamp01(v)) ** 3;
const lerp = (a: number, b: number, p: number) => a + (b - a) * p;
const f = (v: number) => String(Math.round(v * 100) / 100);

const circleD = (cx: number, cy: number, r: number) => `M${f(cx - r)} ${f(cy)}a${f(r)} ${f(r)} 0 1 0 ${f(2 * r)} 0a${f(r)} ${f(r)} 0 1 0 ${f(-2 * r)} 0Z`;
function rrD(x: number, y: number, w: number, h: number, r: number): string {
  const q = Math.min(r, w / 2, h / 2);
  return `M${f(x + q)} ${f(y)}H${f(x + w - q)}A${f(q)} ${f(q)} 0 0 1 ${f(x + w)} ${f(y + q)}V${f(y + h - q)}A${f(q)} ${f(q)} 0 0 1 ${f(x + w - q)} ${f(y + h)}H${f(x + q)}A${f(q)} ${f(q)} 0 0 1 ${f(x)} ${f(y + h - q)}V${f(y + q)}A${f(q)} ${f(q)} 0 0 1 ${f(x + q)} ${f(y)}Z`;
}

function fillD(d: D, path: string, color: string | CanvasGradient, alpha = 1): void {
  d.ctx.globalAlpha = d.alpha * alpha;
  d.ctx.fillStyle = color;
  d.ctx.fill(d.make(path));
}
function strokeD(d: D, path: string, color: string, width: number, alpha = 1, dash: number[] = []): void {
  const { ctx } = d;
  ctx.globalAlpha = d.alpha * alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.setLineDash(dash);
  ctx.stroke(d.make(path));
  ctx.setLineDash([]);
}

interface TextStyle { size: number; weight?: number; color?: string; align?: CanvasTextAlign; alpha?: number }
function text(d: D, s: string, x: number, y: number, st: TextStyle): void {
  const { ctx } = d;
  ctx.globalAlpha = d.alpha * (st.alpha ?? 1);
  ctx.font = `${String(st.weight ?? 400)} ${String(st.size)}px ${FONT}`;
  ctx.fillStyle = st.color ?? C.text;
  ctx.textAlign = st.align ?? "left";
  ctx.fillText(s, x, y);
}
function width(d: D, s: string, st: TextStyle): number {
  d.ctx.font = `${String(st.weight ?? 400)} ${String(st.size)}px ${FONT}`;
  return d.ctx.measureText(s).width;
}
/** Greedy word wrap, at most `max` lines (the last one ends with "…" when cut). */
function wrap(d: D, s: string, maxW: number, st: TextStyle, max = 3): string[] {
  const words = s.split(/\s+/).filter((w) => w.length > 0);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const next = line === "" ? w : `${line} ${w}`;
    if (line !== "" && width(d, next, st) > maxW) {
      lines.push(line);
      line = w;
    } else line = next;
  }
  if (line !== "") lines.push(line);
  if (lines.length > max) {
    const kept = lines.slice(0, max);
    kept[max - 1] = `${kept[max - 1] ?? ""}…`;
    return kept;
  }
  return lines;
}
function paragraph(d: D, s: string, x: number, y: number, maxW: number, lh: number, st: TextStyle, max = 3): number {
  const lines = wrap(d, s, maxW, st, max);
  lines.forEach((l, i) => { text(d, l, x, y + i * lh, st); });
  return y + lines.length * lh;
}
function pill(d: D, label: string, cx: number, y: number, st: TextStyle & { bg: string; padX?: number; h?: number; icon?: string }): void {
  const h = st.h ?? Math.round(st.size * 1.9);
  const iconW = st.icon === undefined ? 0 : st.size * 1.15;
  const w = width(d, label, st) + 2 * (st.padX ?? st.size * 0.8) + iconW;
  const x = st.align === "left" ? cx : cx - w / 2;
  fillD(d, rrD(x, y, w, h, h / 2), st.bg);
  const tx = x + (st.padX ?? st.size * 0.8) + iconW;
  if (st.icon !== undefined) {
    const { ctx } = d;
    ctx.save();
    ctx.translate(x + (st.padX ?? st.size * 0.8) + st.size * 0.42, y + h / 2);
    ctx.scale(st.size / 24, st.size / 24);
    strokeD(d, st.icon, st.color ?? C.text, 2.2);
    ctx.restore();
  }
  text(d, label, tx, y + h / 2 + st.size * 0.35, { ...st, align: "left" });
}
function fitScene(d: D, scene: Scene, x: number, y: number, w: number, h: number, alpha = 1): void {
  const [, , bw, bh] = scene.box;
  const s = Math.min(w / bw, h / bh);
  const { ctx } = d;
  ctx.save();
  ctx.translate(x + (w - bw * s) / 2, y + (h - bh * s) / 2);
  ctx.globalAlpha = d.alpha * alpha;
  drawScene(ctx, scene, { scale: s, makePath: d.make, alpha: d.alpha * alpha, labelColor: C.brand });
  ctx.restore();
}

/** The tooth in a round frame: gum above, crown below, a soft ring around (title and end cards). */
function medallion(d: D, scene: Scene | undefined, cx: number, cy: number, r: number, alpha: number): void {
  fillD(d, circleD(cx, cy, r + 34), C.brandSoft, alpha);
  fillD(d, circleD(cx, cy, r), C.card, alpha);
  if (scene === undefined) return;
  const [, , bw, bh] = scene.box;
  const s = (2 * r) / (bh * 0.6);
  const { ctx } = d;
  ctx.save();
  ctx.clip(d.make(circleD(cx, cy, r)));
  ctx.translate(cx - (bw * s) / 2, cy - bh * s * 0.74);
  drawScene(ctx, scene, { scale: s, makePath: d.make, alpha: d.alpha * alpha });
  ctx.restore();
  strokeD(d, circleD(cx, cy, r), C.card, 6, alpha);
}

// ---------- background and progress ----------

const SECTIONS: readonly SectionName[] = ["title", "overview", "zoom", "stepper", "back", "findings", "discussed", "end"];

function background(d: D): void {
  const { ctx } = d;
  ctx.globalAlpha = 1;
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  const g = ctx.createLinearGradient(0, 0, 0, 620);
  g.addColorStop(0, C.brandSoft);
  g.addColorStop(1, C.bg);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, WIDTH, 620);
}

/** Story-style bars along the top: one per section, filled as the video plays. */
function progress(d: D, board: readonly Segment[], t: number): void {
  const spans = SECTIONS.map((name) => {
    const segs = board.filter((s) => sectionOf(s) === name);
    const first = segs[0], last = segs[segs.length - 1];
    return first === undefined || last === undefined ? undefined : { start: first.start, end: last.end };
  }).filter((s): s is { start: number; end: number } => s !== undefined);
  const gap = 8, x0 = 40, total = WIDTH - 2 * x0 - gap * (spans.length - 1);
  const dur = spans.reduce((a, s) => a + (s.end - s.start), 0) || 1;
  let x = x0;
  for (const s of spans) {
    const w = (total * (s.end - s.start)) / dur;
    fillD(d, rrD(x, 30, w, 6, 3), C.brand, 0.16);
    const p = clamp01((t - s.start) / (s.end - s.start));
    if (p > 0) fillD(d, rrD(x, 30, Math.max(6, w * p), 6, 3), C.brand, 0.9);
    x += w + gap;
  }
}

// ---------- the overview arch ----------

interface Cam { s: number; fromX: number; fromY: number; toX: number; toY: number }
const ARCH_BOX = { x: 40, y: 380, w: 640, h: 590 };

function archFrame(story: PreparedStory): { k: number; ox: number; oy: number } {
  const { width: aw, minY, maxY } = story.arch;
  const k = Math.min(ARCH_BOX.w / (aw + 40), ARCH_BOX.h / (maxY - minY));
  const ox = ARCH_BOX.x + (ARCH_BOX.w - aw * k) / 2;
  const oy = ARCH_BOX.y + (ARCH_BOX.h - (maxY - minY) * k) / 2 - minY * k;
  return { k, ox, oy };
}

function badge(d: D, kind: Badge, x: number, y: number, r: number): void {
  const { ctx } = d;
  const glyph = (g: string, color: string, sc: number, w: number) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(r / sc, r / sc);
    strokeD(d, g, color, w * sc);
    ctx.restore();
  };
  if (kind === "found") {
    fillD(d, rrD(x - r, y - r, 2 * r, 2 * r, r * 0.42), C.found);
    glyph(GLYPH.found, C.card, 1.2, 0.38);
  } else if (kind === "here") {
    fillD(d, circleD(x, y, r), C.brand);
    glyph(GLYPH.check, C.card, 1.45, 0.38);
  } else if (kind === "elsewhere") {
    fillD(d, circleD(x, y, r), C.card);
    strokeD(d, circleD(x, y, r), C.slate, r * 0.18);
    glyph(GLYPH.out, C.slate, 1.5, 0.34);
  } else {
    fillD(d, circleD(x, y, r), C.card);
    strokeD(d, circleD(x, y, r), C.muted, r * 0.18, 1, [r * 0.3, r * 0.2]);
    glyph(GLYPH.clock, C.muted, 1.4, 0.3);
  }
}

interface ArchLook {
  /** 0..1 per tooth: how far its entrance has run. */
  enter: (i: number) => number;
  /** ms, for the today ring's pulse. */
  t: number;
  /** Planned teeth glow (back to all teeth). */
  glow: number;
  /** Tags, badges and numbers (faded out while the camera zooms in). */
  marks?: number;
}

function drawTooth(d: D, p: ArchTooth): void {
  const { ctx } = d;
  const { slot, s } = p;
  if (p.scene !== undefined) {
    const [, , bw, bh] = p.scene.box;
    const kk = slot.w / (bw - 12);
    ctx.save();
    ctx.translate(slot.x, slot.y);
    ctx.rotate((slot.angle * Math.PI) / 180);
    ctx.translate((-bw * kk) / 2, (-bh * kk) / 2);
    drawScene(ctx, p.scene, { scale: kk, makePath: d.make, alpha: d.alpha });
    ctx.restore();
  } else {
    const w = slot.w * 0.9, h = slot.h * 0.86;
    ctx.save();
    ctx.translate(slot.x, slot.y);
    ctx.rotate((slot.angle * Math.PI) / 180);
    const path = rrD(-w / 2, -h / 2, w, h, Math.min(w, h) * 0.34);
    fillD(d, path, s.shown === "not_recorded" ? C.nrFill : C.stage2);
    strokeD(d, path, C.nr, 1.3);
    ctx.restore();
  }
}

function drawArch(d: D, story: PreparedStory, look: ArchLook, cam: Cam | undefined): void {
  const { ctx } = d;
  const { k, ox, oy } = archFrame(story);
  const { teeth, width: aw, midY } = story.arch;
  ctx.save();
  if (cam !== undefined) {
    ctx.translate(cam.toX, cam.toY);
    ctx.scale(cam.s, cam.s);
    ctx.translate(-cam.fromX, -cam.fromY);
  }
  ctx.translate(ox, oy);
  ctx.scale(k, k);
  // gums
  const bandW = Math.max(...teeth.map((p) => p.r), 10) * 2.2;
  for (const arch of ["upper", "lower"] as const) {
    const pts = teeth.filter((p) => p.s.arch === arch).map((p) => `${f(p.slot.x)} ${f(p.slot.y)}`);
    if (pts.length > 1) strokeD(d, `M${pts.join("L")}`, C.gum, bandW);
  }
  text(d, "UPPER", aw / 2, midY - 9, { size: 11, weight: 700, color: C.muted, align: "center" });
  text(d, "LOWER", aw / 2, midY + 19, { size: 11, weight: 700, color: C.muted, align: "center" });
  text(d, "Your right", -16, midY + 4, { size: 11.5, color: C.muted });
  text(d, "Your left", aw + 16, midY + 4, { size: 11.5, color: C.muted, align: "right" });

  const saved = d.alpha;
  teeth.forEach((p, i) => {
    const e = easeOut(look.enter(i));
    if (e <= 0) return;
    const { slot, s, r } = p;
    d.alpha = saved * e;
    ctx.save();
    ctx.translate(slot.x, slot.y);
    const sc = 0.7 + 0.3 * e;
    ctx.scale(sc, sc);
    ctx.translate(-slot.x, -slot.y);
    if (s.planned && look.glow > 0) {
      const ph = (look.t % 1400) / 1400;
      fillD(d, circleD(slot.x, slot.y, r + 9 + 6 * ph), C.amber, look.glow * 0.22 * (1 - ph));
      fillD(d, circleD(slot.x, slot.y, r + 7), C.amberSoft, look.glow);
    }
    drawTooth(d, p);
    const ringT = r + 3.2, ringP = r + (s.today ? 7 : 3.4);
    if (s.today) {
      const ph = (look.t % 2000) / 2000;
      strokeD(d, circleD(slot.x, slot.y, ringT * (1 + 0.35 * ph)), C.brand, 2, 0.55 * (1 - ph));
      strokeD(d, circleD(slot.x, slot.y, ringT), C.brand, 2.6);
    }
    if (s.planned) strokeD(d, circleD(slot.x, slot.y, ringP), C.amber, 2 + look.glow, 1, [4.6, 3.4]);
    ctx.restore();
  });
  // marks above every tooth
  teeth.forEach((p, i) => {
    const e = easeOut(look.enter(i)) * (look.marks ?? 1);
    if (e <= 0) return;
    d.alpha = saved * e;
    const { s, slot, nx, ny, r } = p;
    const ring = s.planned ? (s.today ? r + 7 : r + 3.4) : s.today ? r + 3.2 : r;
    if (s.badge !== undefined) {
      const a = s.today ? 0.95 : 0;
      const bx = nx * Math.cos(a) - ny * Math.sin(a), by = nx * Math.sin(a) + ny * Math.cos(a);
      badge(d, s.badge, slot.x + bx * (ring + 8), slot.y + by * (ring + 8), 6.8);
    }
    if (s.today) {
      const tx = slot.x + nx * (ring + 13), ty = slot.y + ny * (ring + 13);
      fillD(d, rrD(tx - 21, ty - 8, 42, 16, 8), C.brand);
      text(d, "TODAY", tx, ty + 3.4, { size: 9.4, weight: 800, color: C.card, align: "center" });
    }
    if (s.tooth !== undefined) {
      const lo = ring + 8;
      text(d, String(s.fdi), slot.x - nx * lo, slot.y - ny * lo + 4.5, { size: 12.5, weight: 700, color: C.text, align: "center" });
    }
  });
  d.alpha = saved;
  ctx.restore();
}

/** Where the walked tooth sits on the canvas in the overview. */
function toothPoint(story: PreparedStory, fdi: number): [number, number] {
  const { k, ox, oy } = archFrame(story);
  const p = story.arch.teeth.find((x) => x.s.fdi === fdi);
  return p === undefined ? [WIDTH / 2, ARCH_BOX.y + ARCH_BOX.h / 2] : [ox + p.slot.x * k, oy + p.slot.y * k];
}
const ZOOM = 5;
function zoomCam(story: PreparedStory, fdi: number, p: number): Cam {
  const [x, y] = toothPoint(story, fdi);
  return { s: lerp(1, ZOOM, p), fromX: x, fromY: y, toX: lerp(x, WIDTH / 2, p), toY: lerp(y, STAGE.y + STAGE.h / 2, p) };
}

type LegendKind = "today" | "planned" | Badge;
const LEGEND: readonly [LegendKind, string][] = [["today", "Treated today"], ["planned", "Planned"], ["found", "Found today"], ["here", "Done here"], ["elsewhere", "Done elsewhere"], ["before", "Done before"]];

function legend(d: D, story: PreparedStory, y0: number): void {
  const states = [...story.facts.states.upper, ...story.facts.states.lower];
  const has = (k: LegendKind) => states.some((s) => (k === "today" ? s.today : k === "planned" ? s.planned : s.badge === k));
  const items = LEGEND.filter(([k]) => has(k));
  items.forEach(([k, label], i) => {
    const col = i % 2, row = Math.floor(i / 2);
    const x = 70 + col * 310, y = y0 + row * 64;
    const r = 15;
    if (k === "today") {
      fillD(d, circleD(x, y, r * 0.7), C.stage2);
      strokeD(d, circleD(x, y, r), C.brand, 4);
    } else if (k === "planned") {
      fillD(d, circleD(x, y, r * 0.7), C.stage2);
      strokeD(d, circleD(x, y, r), C.amber, 3.5, 1, [7, 5]);
    } else badge(d, k, x, y, r);
    text(d, label, x + 32, y + 12, { size: 34, color: C.text });
  });
}

function overviewHeader(d: D, story: PreparedStory, alpha: number): void {
  const { need, today, nextVisit } = story.facts;
  const a = d.alpha;
  d.alpha = a * alpha;
  text(d, "Your teeth", 40, 150, { size: 66, weight: 800 });
  text(d, `${String(need)} ${need === 1 ? "tooth needs" : "teeth need"} attention`, 40, 222, { size: 46, weight: 700, color: C.text });
  text(d, `${String(today)} treated today`, 40, 276, { size: 40, color: C.muted });
  if (nextVisit !== undefined) pill(d, `Next visit: ${nextVisit}`, 40, 302, { size: 32, weight: 700, color: C.amber, bg: C.amberSoft, align: "left", icon: GLYPH.calendar });
  d.alpha = a;
}

// ---------- tooth detail and the stepper ----------

const STAGE = { x: 40, y: 270, w: 640, h: 560 };
const VIEW_LABEL: Readonly<Record<string, string>> = { section: "Inside view", front: "Outside view", top: "Chewing side" };

function detailHeader(d: D, story: PreparedStory): void {
  const focus = story.facts.focus;
  if (focus === undefined) return;
  const info = toothInfo(focus.fdi);
  text(d, `TOOTH ${String(focus.fdi)} · ${info.name.toUpperCase()}`, 40, 128, { size: 28, weight: 800, color: C.brand });
  paragraph(d, MODEL_WORDS[focus.treatment.model] ?? "Treatment", 40, 204, 640, 64, { size: 58, weight: 800 }, 1);
}
const MODEL_WORDS: Readonly<Record<string, string>> = {
  root_canal: "Root canal treatment", filling: "Filling", extraction: "Tooth removal", wisdom_extraction: "Wisdom tooth removal",
  crown: "Crown", scaling: "Cleaning", implant: "Implant", sealant: "Sealant",
};

function stageCard(d: D, scene: Scene | undefined, prev: Scene | undefined, q: number): void {
  fillD(d, rrD(STAGE.x, STAGE.y, STAGE.w, STAGE.h, 36), C.stage);
  strokeD(d, rrD(STAGE.x, STAGE.y, STAGE.w, STAGE.h, 36), C.line, 2);
  const pad = 40;
  if (prev !== undefined && prev !== scene && q < 1) fitScene(d, prev, STAGE.x + pad, STAGE.y + pad, STAGE.w - 2 * pad, STAGE.h - 2 * pad, 1 - q);
  if (scene !== undefined) fitScene(d, scene, STAGE.x + pad, STAGE.y + pad, STAGE.w - 2 * pad, STAGE.h - 2 * pad, prev === scene ? 1 : q);
}

function viewTag(d: D, story: PreparedStory, index: number): void {
  const view = story.stepViews[index];
  if (view === undefined) return;
  pill(d, VIEW_LABEL[view] ?? "", STAGE.x + 24, STAGE.y + 24, { size: 24, weight: 700, color: C.muted, bg: "rgba(255,255,255,0.8)", align: "left" });
}

function stepper(d: D, story: PreparedStory, index: number, prevIndex: number, q: number): void {
  const focus = story.facts.focus;
  if (focus === undefined) return;
  const steps = focus.treatment.steps;
  const n = steps.length;
  const y = 900, x0 = n === 1 ? WIDTH / 2 : 110, x1 = n === 1 ? WIDTH / 2 : WIDTH - 110;
  const xs = steps.map((_, i) => (n === 1 ? x0 : lerp(x0, x1, i / (n - 1))));
  for (let i = 0; i + 1 < n; i++) {
    const a = xs[i] ?? 0, b = xs[i + 1] ?? 0;
    const done = steps[i + 1]?.state === "done" || steps[i + 1]?.state === "current";
    strokeD(d, `M${f(a + 26)} ${f(y)}H${f(b - 26)}`, done ? C.brand : C.nr, 5, 1, done ? [] : [10, 9]);
  }
  // the moving halo on the step being shown
  const hx = lerp(xs[prevIndex] ?? 0, xs[index] ?? 0, ease(q));
  fillD(d, circleD(hx, y, 40), C.brand, 0.14);
  steps.forEach((s, i) => {
    const x = xs[i] ?? 0;
    const r = 22;
    if (s.state === "done") {
      fillD(d, circleD(x, y, r), C.brand);
      const { ctx } = d;
      ctx.save(); ctx.translate(x, y); ctx.scale(12, 12); strokeD(d, GLYPH.check, C.card, 0.3); ctx.restore();
    } else if (s.state === "current") {
      fillD(d, circleD(x, y, r), C.card);
      strokeD(d, circleD(x, y, r), C.brand, 6);
      fillD(d, circleD(x, y, 9), C.brand);
    } else if (s.state === "next") {
      fillD(d, circleD(x, y, r), C.amberSoft);
      strokeD(d, circleD(x, y, r), C.amber, 5);
    } else {
      fillD(d, circleD(x, y, r), C.bg);
      strokeD(d, circleD(x, y, r), C.slate, 3.5, 1, [7, 6]);
    }
    const label = focus.labels[i]?.short ?? "";
    text(d, label, x, y + 66, { size: 28, weight: i === index ? 800 : 500, color: i === index ? C.text : C.muted, align: "center" });
    if (s.state === "current") {
      const w = width(d, "You are here", { size: 24, weight: 800 }) + 28;
      fillD(d, rrD(x - w / 2, y - 78, w, 40, 20), C.brand);
      fillD(d, `M${f(x - 9)} ${f(y - 39)}L${f(x)} ${f(y - 29)}L${f(x + 9)} ${f(y - 39)}Z`, C.brand);
      text(d, "You are here", x, y - 49, { size: 24, weight: 800, color: C.card, align: "center" });
    }
  });
}

function caption(d: D, story: PreparedStory, index: number, alpha: number): void {
  const focus = story.facts.focus;
  const step = stepOf(story.facts, index);
  if (focus === undefined || step === undefined) return;
  const label = focus.labels[index];
  const color = step.state === "next" ? C.amber : step.state === "usual" ? C.slate : C.brand;
  text(d, label?.heading ?? "", 40, 1036, { size: 36, weight: 800, color, alpha });
  paragraph(d, step.words, 40, 1100, 640, 58, { size: 46, weight: 600, color: C.text, alpha }, 3);
}

function detail(d: D, story: PreparedStory, index: number, prevIndex: number, q: number): void {
  const scene = story.steps[index];
  const prev = story.steps[prevIndex];
  detailHeader(d, story);
  stageCard(d, scene, prev, q);
  viewTag(d, story, index);
  stepper(d, story, index, prevIndex, q);
  if (prevIndex !== index && q < 1) caption(d, story, prevIndex, 1 - clamp01(q * 2));
  caption(d, story, index, prevIndex === index ? 1 : clamp01(q * 2 - 1));
}

// ---------- segments ----------

function titleCard(d: D, story: PreparedStory, t: number): void {
  const { facts, hero } = story;
  const appear = (delay: number) => easeOut((t - delay) / 500);
  const a = d.alpha;
  const h = appear(0);
  medallion(d, hero, WIDTH / 2, 420 + 16 * (1 - h), 170 * (0.92 + 0.08 * h), h);
  const k = appear(200), c = appear(350), dt = appear(500);
  text(d, "YOUR VISIT", WIDTH / 2, 720 + 16 * (1 - k), { size: 30, weight: 800, color: C.brand, align: "center", alpha: k });
  d.alpha = a * c;
  const end = paragraph(d, facts.clinic, WIDTH / 2, 800 + 16 * (1 - c), 620, 74, { size: 64, weight: 800, align: "center" }, 2);
  d.alpha = a;
  text(d, facts.visitDay, WIDTH / 2, end + 30 + 16 * (1 - dt), { size: 38, color: C.muted, align: "center", alpha: dt });
}

function overview(d: D, story: PreparedStory, t: number): void {
  overviewHeader(d, story, easeOut(t / 400));
  const n = story.arch.teeth.length;
  drawArch(d, story, { enter: (i) => (t - 150 - (i * 700) / Math.max(1, n)) / 350, t, glow: 0 }, undefined);
  const a = d.alpha;
  d.alpha = a * easeOut((t - 900) / 500);
  legend(d, story, 1040);
  d.alpha = a;
}

function zoom(d: D, story: PreparedStory, fdi: number, t: number, len: number): void {
  const p = ease(t / (len * 0.75));
  const a = d.alpha;
  d.alpha = a * (1 - clamp01(t / 350));
  overviewHeader(d, story, 1);
  legend(d, story, 1040);
  const q = ease((t - len * 0.55) / (len * 0.4));
  d.alpha = a * (1 - q);
  drawArch(d, story, { enter: () => 1, t, glow: 0, marks: 1 - clamp01(p * 3) }, zoomCam(story, fdi, p));
  d.alpha = a * q;
  detail(d, story, 0, 0, 1);
  d.alpha = a;
}

function back(d: D, story: PreparedStory, fdi: number, t: number): void {
  const a = d.alpha;
  const out = clamp01(t / 450);
  const lastIndex = Math.max(0, story.steps.length - 1);
  if (out < 1) {
    d.alpha = a * (1 - out);
    detail(d, story, lastIndex, lastIndex, 1);
  }
  const p = ease(t / 1000);
  d.alpha = a * ease((t - 200) / 450);
  drawArch(d, story, { enter: () => 1, t, glow: easeOut((t - 900) / 500), marks: clamp01((p - 0.55) / 0.45) }, zoomCam(story, fdi, 1 - p));
  // "Planned next": header and list
  const h = easeOut((t - 900) / 450);
  d.alpha = a * h;
  const { planned, nextVisit } = story.facts;
  text(d, "COMING UP", 40, 128, { size: 28, weight: 800, color: C.amber });
  text(d, planned.length > 0 ? "Planned next" : "All your teeth", 40, 204, { size: 62, weight: 800 });
  if (nextVisit !== undefined) pill(d, `Next visit: ${nextVisit}`, 40, 236, { size: 32, weight: 700, color: C.amber, bg: C.amberSoft, align: "left", icon: GLYPH.calendar });
  planned.slice(0, 3).forEach((item, i) => {
    const e = easeOut((t - 1100 - i * 160) / 400);
    const y = 1040 + i * 74;
    d.alpha = a * e;
    strokeD(d, circleD(64 + 20 * (1 - e), y - 14, 17), C.amber, 4, 1, [7, 5]);
    text(d, String(item.fdi), 64 + 20 * (1 - e), y - 4, { size: 22, weight: 800, color: C.amber, align: "center" });
    text(d, item.words, 100 + 20 * (1 - e), y, { size: 46, weight: 700 });
  });
  d.alpha = a;
}

function findings(d: D, story: PreparedStory, t: number): void {
  const { findings: list } = story.facts;
  const h = easeOut(t / 400);
  text(d, "TODAY", 40, 128, { size: 28, weight: 800, color: C.found, alpha: h });
  text(d, "What we found", 40, 204, { size: 62, weight: 800, alpha: h });
  if (list.length === 1 && list[0] !== undefined) { oneFinding(d, story, list[0], t); return; }
  const rowH = 250, gap = 30;
  const total = list.length * rowH + (list.length - 1) * gap;
  const top = Math.max(290, 290 + (760 - total) / 2);
  const a = d.alpha;
  list.forEach((item, i) => {
    const e = easeOut((t - 200 - i * 180) / 450);
    const y = top + i * (rowH + gap);
    const dx = 60 * (1 - e);
    d.alpha = a * e;
    fillD(d, rrD(40 + dx, y, 640, rowH, 32), C.card);
    strokeD(d, rrD(40 + dx, y, 640, rowH, 32), C.line, 2);
    fillD(d, circleD(150 + dx, y + rowH / 2, 82), C.foundSoft);
    const tooth = story.arch.teeth.find((p) => p.s.fdi === item.fdi)?.scene;
    if (tooth !== undefined) fitScene(d, tooth, 150 + dx - 58, y + rowH / 2 - 58, 116, 116);
    text(d, `Tooth ${String(item.fdi)}`, 262 + dx, y + 66, { size: 30, weight: 700, color: C.muted });
    const end = paragraph(d, item.words, 262 + dx, y + 122, 400, 54, { size: 46, weight: 800, color: C.found }, 2);
    if (item.extra !== undefined) pill(d, item.extra, 262 + dx, Math.min(end - 26, y + rowH - 62), { size: 26, weight: 700, color: C.amber, bg: C.amberSoft, align: "left" });
  });
  d.alpha = a;
}

/** A single finding, large: the tooth in a round frame, its number and the words. */
function oneFinding(d: D, story: PreparedStory, item: Finding, t: number): void {
  const e = easeOut((t - 150) / 500);
  const a = d.alpha;
  d.alpha = a * e;
  const cy = 560 + 30 * (1 - e);
  fillD(d, circleD(WIDTH / 2, cy, 210), C.foundSoft);
  fillD(d, circleD(WIDTH / 2, cy, 160), C.card, 0.75);
  const tooth = story.arch.teeth.find((p) => p.s.fdi === item.fdi)?.scene;
  if (tooth !== undefined) fitScene(d, tooth, WIDTH / 2 - 125, cy - 125, 250, 250);
  const w = appearAt(t, 300);
  d.alpha = a * w;
  text(d, `Tooth ${String(item.fdi)} · ${toothInfo(item.fdi).name}`, WIDTH / 2, 860, { size: 32, weight: 700, color: C.muted, align: "center" });
  const end = paragraph(d, item.words, WIDTH / 2, 940, 620, 62, { size: 54, weight: 800, color: C.found, align: "center" }, 2);
  if (item.extra !== undefined) pill(d, item.extra, WIDTH / 2, end - 10, { size: 32, weight: 700, color: C.amber, bg: C.amberSoft, align: "center" });
  d.alpha = a;
}
const appearAt = (t: number, delay: number) => easeOut((t - delay) / 450);

/** One ticked "Options we discussed" row: the situation, then each option's name, short words and any price. */
function discussedCard(d: D, story: PreparedStory, index: number, t: number): void {
  const row = story.facts.discussed[index];
  if (row === undefined) return;
  const h = easeOut(t / 400);
  text(d, "OPTIONS WE DISCUSSED", 40, 128, { size: 28, weight: 800, color: C.brand, alpha: h });
  const end = paragraph(d, row.title, 40, 204, 640, 70, { size: 58, weight: 800, alpha: h }, 2);
  if (row.tooth !== undefined) text(d, `Tooth ${String(row.tooth)} · ${toothInfo(row.tooth).name}`, 40, end + 14, { size: 32, weight: 700, color: C.muted, alpha: h });
  const rowH = 250, gap = 28, top = end + 90;
  const a = d.alpha;
  row.options.forEach((o, i) => {
    const e = easeOut((t - 200 - i * 180) / 450);
    const y = top + i * (rowH + gap);
    d.alpha = a * e;
    const dx = 60 * (1 - e);
    fillD(d, rrD(40 + dx, y, 640, rowH, 32), C.card);
    strokeD(d, rrD(40 + dx, y, 640, rowH, 32), o.preferred ? C.brand : C.line, o.preferred ? 4 : 2);
    const lend = paragraph(d, o.label, 72 + dx, y + 62, 576, 52, { size: 44, weight: 800 }, 1);
    const send = o.summary === undefined ? lend : paragraph(d, o.summary, 72 + dx, lend + 6, 576, 40, { size: 30, color: C.muted }, 2);
    if (o.price !== undefined) pill(d, o.price, 72 + dx, Math.min(send + 4, y + rowH - 62), { size: 28, weight: 700, color: C.amber, bg: C.amberSoft, align: "left" });
    if (o.preferred) pill(d, "You prefer this", 648 + dx, y + 8, { size: 24, weight: 700, color: C.brand, bg: C.brandSoft, align: "right" });
  });
  d.alpha = a;
}

function endCard(d: D, story: PreparedStory, t: number): void {
  const { facts, hero } = story;
  const appear = (delay: number) => easeOut((t - delay) / 450);
  const h = appear(0);
  medallion(d, hero, WIDTH / 2, 330, 120, h);
  const c = appear(120);
  const a = d.alpha;
  d.alpha = a * c;
  const end = paragraph(d, facts.clinic, WIDTH / 2, 570, 620, 70, { size: 58, weight: 800, align: "center" }, 2);
  fillD(d, rrD(WIDTH / 2 - 40, end - 24, 80, 6, 3), C.brand);
  d.alpha = a * appear(260);
  const end2 = paragraph(d, "Open your visit page for details", WIDTH / 2, end + 60, 600, 56, { size: 44, weight: 700, align: "center" }, 2);
  text(d, "To book, reply or call", WIDTH / 2, end2 + 16, { size: 44, color: C.muted, align: "center" });
  d.alpha = a * appear(400);
  if (facts.nextVisit !== undefined) pill(d, `Next visit: ${facts.nextVisit}`, WIDTH / 2, end2 + 70, { size: 34, weight: 700, color: C.amber, bg: C.amberSoft, align: "center", icon: GLYPH.calendar });
  d.alpha = a;
  text(d, facts.visitNumber, WIDTH / 2, 1210, { size: 28, weight: 600, color: C.muted, align: "center", alpha: c });
}

function clinicLine(d: D, story: PreparedStory, alpha: number): void {
  text(d, story.facts.clinic, 40, 76, { size: 24, weight: 700, color: C.muted, alpha });
}

function segment(d: D, story: PreparedStory, seg: Segment, t: number): void {
  const local = t - seg.start;
  switch (seg.kind) {
    case "title": titleCard(d, story, local); break;
    case "overview": overview(d, story, local); break;
    case "zoom": zoom(d, story, seg.fdi, local, seg.end - seg.start); break;
    case "step": {
      const q = clamp01(local / 380);
      detail(d, story, seg.index, seg.index === 0 ? 0 : seg.index - 1, q);
      break;
    }
    case "back": back(d, story, seg.fdi, local); break;
    case "findings": findings(d, story, local); break;
    case "discussed": discussedCard(d, story, seg.index, local); break;
    case "end": endCard(d, story, local); break;
  }
}

/** Segments that cross-fade in from the one before (the zoom and the stepper move instead). */
const FADES = new Set<Segment["kind"]>(["overview", "findings", "discussed", "end"]);
const FADE_MS = 380;

/** Paints the frame at `t` ms. Pure: it reads only `story` and `t`. */
export function drawFrame(ctx: StoryCtx, story: PreparedStory, t: number, opts: DrawOptions = {}): void {
  const make = opts.makePath ?? cachedPath;
  const d: D = { ctx, make, alpha: 1 };
  const time = Math.min(Math.max(0, t), Math.max(0, story.duration - 1));
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.textBaseline = "alphabetic";
  ctx.setLineDash([]);
  background(d);
  const board = story.board;
  const i = board.findIndex((s) => time < s.end);
  const seg = board[i === -1 ? board.length - 1 : i];
  if (seg === undefined) return;
  const prev = i > 0 ? board[i - 1] : undefined;
  const local = time - seg.start;
  const side = seg.kind !== "title" && seg.kind !== "end";
  if (prev !== undefined && FADES.has(seg.kind) && local < FADE_MS) {
    const q = ease(local / FADE_MS);
    d.alpha = 1 - q;
    segment(d, story, prev, prev.end - 1);
    if (prev.kind !== "title" && prev.kind !== "end") clinicLine(d, story, 1);
    d.alpha = q;
    segment(d, story, seg, time);
    if (side) clinicLine(d, story, 1);
  } else {
    segment(d, story, seg, time);
    d.alpha = 1;
    if (side) clinicLine(d, story, 1);
  }
  d.alpha = 1;
  progress(d, board, time);
  ctx.globalAlpha = 1;
}

const paths = new Map<string, PathLike>();
/** Path2D objects are reused across frames (the same `d`, the same path). */
function cachedPath(dStr: string): PathLike {
  if (dStr === "") return new Path2D(); // drawScene adds to an empty path: never share it
  let p = paths.get(dStr);
  if (p === undefined) {
    if (paths.size > 4000) paths.clear();
    p = new Path2D(dStr);
    paths.set(dStr, p);
  }
  return p;
}
