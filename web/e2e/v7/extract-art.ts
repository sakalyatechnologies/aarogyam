// Extracts the v7 mockup's vector art as flat layers: icons, avatars and illustrations.
// Each layer is a path (in the art's own coordinates, transforms baked into a matrix), its paint
// (a colour, a design-token name or a gradient) and its loop animation class, if any.
// Output: docs/mockups/art/v7-art.json. Run: node web/e2e/v7/extract-art.ts
import { chromium } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

type Paint =
  | { kind: "none" }
  | { kind: "color"; value: string }
  | { kind: "gradient"; id: string };
type Stop = { offset: number; color: string; opacity: number };
type Gradient = {
  id: string;
  type: "linear" | "radial";
  attrs: Record<string, string>;
  stops: Stop[];
};
type Layer = {
  d: string;
  matrix: number[];
  fill: Paint;
  stroke: Paint;
  strokeWidth: number;
  opacity: number;
  fillOpacity: number;
  strokeOpacity: number;
  cap: string;
  join: string;
  /** Loop animations on this layer's ancestors, innermost first; [node] groups layers that move together. */
  loops: { loop: string; node: number }[];
};
type Art = { viewBox: number[]; layers: Layer[]; gradients: Gradient[]; rootLoops: string[] };
type Out = {
  source: string;
  icons: Record<string, Art>;
  avatars: Record<string, Art>;
  art: Record<string, Art>;
};

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const mockup = `file://${root}/docs/mockups/mobile-v7.html`;
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(mockup, { waitUntil: "networkidle" });
// The mockup keeps its code inside one closure, so its art builders (icons to implantArt) are
// lifted out of the source and run on their own, handing themselves over on globalThis.
const html = readFileSync(resolve(root, "docs/mockups/mobile-v7.html"), "utf8");
const from = html.indexOf("/* ================= icons");
const to = html.indexOf("const EXP");
if (from < 0 || to < from) throw new Error("art builders not found in the mockup");
await page.addScriptTag({
  content: `{ ${html.slice(from, to)}\nglobalThis.__v7art = { I, AVS, avatarSVG, toothArt, familyArt, implantArt }; }`,
});

const out = await page.evaluate((): Out => {
  const LOOPS = ["blink", "bob", "glow", "floaty", "rock", "spk", "s2"];
  const host = document.createElement("div");
  host.style.cssText = "position:absolute;left:-9999px;top:0;width:400px;height:400px";
  document.body.appendChild(host);

  const raw = (el: Element, name: string): string | null => {
    for (let e: Element | null = el; e && e.tagName.toLowerCase() !== "svg"; e = e.parentElement) {
      const v = e.getAttribute(name);
      if (v !== null) return v;
      const style = e.getAttribute("style") ?? "";
      const m = new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([^;]+)`).exec(style);
      if (m?.[1]) return m[1].trim();
    }
    return null;
  };
  const paint = (el: Element, name: string, fallback: string): Paint => {
    const v = raw(el, name) ?? fallback;
    if (v === "none" || v === "transparent") return { kind: "none" };
    const url = /url\(#([^)]+)\)/.exec(v);
    if (url?.[1]) return { kind: "gradient", id: url[1] };
    return { kind: "color", value: v };
  };
  const num = (el: Element, name: string, fallback: number): number => {
    const v = raw(el, name);
    const n = v === null ? Number.NaN : Number.parseFloat(v);
    return Number.isFinite(n) ? n : fallback;
  };
  const opacityOf = (el: Element): number => {
    let o = 1;
    for (let e: Element | null = el; e && e.tagName.toLowerCase() !== "svg"; e = e.parentElement) {
      const v = e.getAttribute("opacity");
      if (v !== null) o *= Number.parseFloat(v);
    }
    return o;
  };
  const nodes = new WeakMap<Element, number>();
  let nextNode = 0;
  const loopsOf = (el: Element): { loop: string; node: number }[] => {
    const out: { loop: string; node: number }[] = [];
    for (let e: Element | null = el; e && e.tagName.toLowerCase() !== "svg"; e = e.parentElement) {
      const here = e;
      const hit = LOOPS.filter((c) => here.classList.contains(c));
      if (!hit.length) continue;
      let node = nodes.get(e);
      if (node === undefined) {
        node = nextNode++;
        nodes.set(e, node);
      }
      out.push({ loop: hit.join(" "), node });
    }
    return out;
  };
  const f = (n: number) => String(Math.round(n * 1000) / 1000);
  const pathOf = (el: Element): string | null => {
    const a = (n: string) => Number.parseFloat(el.getAttribute(n) ?? "0");
    switch (el.tagName.toLowerCase()) {
      case "path":
        return el.getAttribute("d");
      case "circle": {
        const [cx, cy, r] = [a("cx"), a("cy"), a("r")];
        return `M${f(cx - r)} ${f(cy)}A${f(r)} ${f(r)} 0 1 0 ${f(cx + r)} ${f(cy)}A${f(r)} ${f(r)} 0 1 0 ${f(cx - r)} ${f(cy)}Z`;
      }
      case "ellipse": {
        const [cx, cy, rx, ry] = [a("cx"), a("cy"), a("rx"), a("ry")];
        return `M${f(cx - rx)} ${f(cy)}A${f(rx)} ${f(ry)} 0 1 0 ${f(cx + rx)} ${f(cy)}A${f(rx)} ${f(ry)} 0 1 0 ${f(cx - rx)} ${f(cy)}Z`;
      }
      case "rect": {
        const [x, y, w, h] = [a("x"), a("y"), a("width"), a("height")];
        const rx = Math.min(el.hasAttribute("rx") ? a("rx") : a("ry"), w / 2);
        const ry = Math.min(el.hasAttribute("ry") ? a("ry") : rx, h / 2);
        if (!rx) return `M${f(x)} ${f(y)}H${f(x + w)}V${f(y + h)}H${f(x)}Z`;
        return (
          `M${f(x + rx)} ${f(y)}H${f(x + w - rx)}A${f(rx)} ${f(ry)} 0 0 1 ${f(x + w)} ${f(y + ry)}V${f(y + h - ry)}` +
          `A${f(rx)} ${f(ry)} 0 0 1 ${f(x + w - rx)} ${f(y + h)}H${f(x + rx)}A${f(rx)} ${f(ry)} 0 0 1 ${f(x)} ${f(y + h - ry)}` +
          `V${f(y + ry)}A${f(rx)} ${f(ry)} 0 0 1 ${f(x + rx)} ${f(y)}Z`
        );
      }
      case "line":
        return `M${f(a("x1"))} ${f(a("y1"))}L${f(a("x2"))} ${f(a("y2"))}`;
      case "polyline":
      case "polygon": {
        const pts = (el.getAttribute("points") ?? "").trim().split(/[\s,]+/).map(Number);
        let d = "";
        for (let i = 0; i + 1 < pts.length; i += 2) d += `${i ? "L" : "M"}${f(pts[i] ?? 0)} ${f(pts[i + 1] ?? 0)}`;
        return el.tagName.toLowerCase() === "polygon" ? `${d}Z` : d;
      }
      default:
        return null;
    }
  };

  const convert = (markup: string, icon: boolean): Art => {
    // Avatars come as bare groups for a 100 by 100 box.
    host.innerHTML = markup.trimStart().startsWith("<svg") ? markup : `<svg viewBox="0 0 100 100">${markup}</svg>`;
    const svg = host.querySelector("svg");
    if (!svg) throw new Error("no svg");
    const vb = (svg.getAttribute("viewBox") ?? "0 0 24 24").split(/[\s,]+/).map(Number);
    const base = svg.getCTM()?.inverse();
    const gradients: Gradient[] = [...svg.querySelectorAll("linearGradient,radialGradient")].map((g) => ({
      id: g.id,
      type: g.tagName === "linearGradient" ? "linear" : "radial",
      attrs: Object.fromEntries([...g.attributes].filter((x) => x.name !== "id").map((x) => [x.name, x.value])),
      stops: [...g.querySelectorAll("stop")].map((s) => ({
        offset: Number.parseFloat(s.getAttribute("offset") ?? "0") * ((s.getAttribute("offset") ?? "").includes("%") ? 0.01 : 1),
        color: s.getAttribute("stop-color") ?? "#000",
        opacity: Number.parseFloat(s.getAttribute("stop-opacity") ?? "1"),
      })),
    }));
    const layers: Layer[] = [];
    for (const el of svg.querySelectorAll("path,circle,ellipse,rect,line,polyline,polygon")) {
      if (el.closest("defs,clipPath,mask")) continue;
      const d = pathOf(el);
      if (!d) continue;
      const ctm = el instanceof SVGGraphicsElement ? el.getCTM() : null;
      const m = base && ctm ? base.multiply(ctm) : new DOMMatrix();
      layers.push({
        d,
        matrix: [m.a, m.b, m.c, m.d, m.e, m.f].map((n) => Math.round(n * 10000) / 10000),
        fill: paint(el, "fill", icon ? "none" : "#000"),
        stroke: paint(el, "stroke", icon ? "currentColor" : "none"),
        strokeWidth: num(el, "stroke-width", icon ? 2 : 1),
        opacity: Math.round(opacityOf(el) * 1000) / 1000,
        fillOpacity: num(el, "fill-opacity", 1),
        strokeOpacity: num(el, "stroke-opacity", 1),
        cap: raw(el, "stroke-linecap") ?? (icon ? "round" : "butt"),
        join: raw(el, "stroke-linejoin") ?? (icon ? "round" : "miter"),
        loops: loopsOf(el),
      });
    }
    const rootLoops = LOOPS.filter((c) => svg.classList.contains(c));
    return { viewBox: vb, layers, gradients, rootLoops };
  };

  const lib: unknown = Reflect.get(globalThis, "__v7art");
  const fn = (name: string): ((...args: unknown[]) => string) => {
    const v: unknown = typeof lib === "object" && lib !== null ? Reflect.get(lib, name) : undefined;
    if (typeof v !== "function") throw new Error(`mockup has no ${name}`);
    return (...args: unknown[]) => String(Reflect.apply(v, undefined, args));
  };
  const I: unknown = typeof lib === "object" && lib !== null ? Reflect.get(lib, "I") : undefined;
  const AVS: unknown = typeof lib === "object" && lib !== null ? Reflect.get(lib, "AVS") : undefined;
  if (typeof I !== "object" || I === null || !Array.isArray(AVS)) throw new Error("mockup art tables missing");
  const avatarSVG = fn("avatarSVG");
  const toothArt = fn("toothArt");
  const familyArt = fn("familyArt");
  const implantArt = fn("implantArt");

  const icons: Record<string, Art> = {};
  for (const [name, body] of Object.entries(I)) {
    icons[name] = convert(`<svg viewBox="0 0 24 24">${String(body)}</svg>`, true);
  }
  const avatars: Record<string, Art> = {};
  for (const a of AVS) {
    const id: unknown = typeof a === "object" && a !== null ? Reflect.get(a, "id") : undefined;
    if (typeof id === "string") avatars[id] = convert(avatarSVG(a), false);
  }
  const art: Record<string, Art> = {
    tooth: convert(toothArt(0), false),
    family: convert(familyArt(), false),
    implant: convert(implantArt(0), false),
  };
  host.remove();
  return { source: "docs/mockups/mobile-v7.html", icons, avatars, art };
});

const dir = resolve(root, "docs/mockups/art");
mkdirSync(dir, { recursive: true });
writeFileSync(resolve(dir, "v7-art.json"), `${JSON.stringify(out, null, 1)}\n`);
const count = (r: Record<string, Art>) => Object.values(r).reduce((n, a) => n + a.layers.length, 0);
process.stdout.write(
  `icons ${String(Object.keys(out.icons).length)} (${String(count(out.icons))} layers), ` +
    `avatars ${String(Object.keys(out.avatars).length)} (${String(count(out.avatars))}), art ${String(count(out.art))}\n`,
);
await browser.close();
