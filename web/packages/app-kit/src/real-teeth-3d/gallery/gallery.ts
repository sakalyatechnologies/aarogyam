// Dev-only gallery of the 3D tooth detail (scripts/teeth3d-gallery.mjs builds and screenshots it).
// Each tile mounts on a fresh canvas, waits for the refined frame, snapshots it with its labels.
import type { Tooth3dHandle } from "../render.js";
import type { Tooth3dOptions } from "../spec.js";
import type { ToothType } from "../../mouth-art/types.js";

type Tile = [string, Tooth3dOptions, string?];
const types: ToothType[] = ["u1", "u2", "u3", "u4", "u5", "u6", "u7", "u8", "l1", "l2", "l3", "l4", "l5", "l6", "l7", "l8", "pu1", "pu2", "pu3", "pu4", "pu5", "pl1", "pl2", "pl3", "pl4", "pl5"];
const rct = (step: string, fdi = 46, view: "front" | "top" | "inside" = "inside"): Tile => [`Root canal: ${step}`, { fdi, stage: { model: "root_canal", step }, view, labels: true }, `${String(fdi)}, ${view}`];

const SECTIONS: [string, Tile[], boolean?][] = [
  ["Front tooth from outside", [
    ["11 from outside", { fdi: 11, view: "front", age: 24 }, "labial convexity, mamelons, incisal translucency"],
    ["11 labelled", { fdi: 11, view: "front", labels: true, age: 24 }],
    ["13 canine", { fdi: 13, view: "front", age: 30 }],
    ["31 lower incisor", { fdi: 31, view: "front", age: 30 }],
  ]],
  ["Molar decay, inside (3 depths)", [
    ["Early decay (enamel)", { fdi: 46, view: "inside", labels: true, details: { caries: [{ surface: "O", depth: "enamel" }] } }],
    ["Decay in dentin", { fdi: 46, view: "inside", labels: true, details: { caries: [{ surface: "O", depth: "dentin" }] } }],
    ["Decay close to the nerve", { fdi: 46, view: "inside", labels: true, details: { caries: [{ surface: "O", depth: "near_pulp" }] } }],
    ["Proximal decay, from outside", { fdi: 46, view: "front", details: { caries: [{ surface: "M", depth: "dentin" }, { surface: "O", depth: "enamel" }] } }],
  ]],
  ["Root canal, every step", [rct("access_clean"), rct("dressing"), rct("obturation"), rct("crown"), rct("access_clean", 46, "top")]],
  ["Incisor 21", [rct("dressing", 21), rct("obturation", 21), rct("access_clean", 21, "top")]],
  ["Impacted wisdom tooth, 4 angles", (["vertical", "mesioangular", "distoangular", "horizontal"] as const).map((a): Tile =>
    [`38 impacted, ${a}`, { fdi: 38, view: "front", labels: true, details: { eruption: "impacted", angulation: a } }])
    .concat([["48 partial, mesioangular", { fdi: 48, view: "front", details: { eruption: "partial", angulation: "mesioangular" } }],
      ["38 impacted horizontal, inside", { fdi: 38, view: "inside", labels: true, details: { eruption: "impacted", angulation: "horizontal" } }]])],
  ["Implant", (["post", "abutment", "crown"]).map((s): Tile => [`Implant: ${s}`, { fdi: 36, stage: { model: "implant", step: s }, view: "front", labels: true }])
    .concat([["Implant crown, inside", { fdi: 36, stage: { model: "implant", step: "crown" }, view: "inside", labels: true }]])],
  ["Other steps", [
    ["Filling: decay", { fdi: 36, stage: { model: "filling", step: "decay" }, details: { caries: [{ surface: "O", depth: "dentin" }] }, view: "top" }],
    ["Filling: cleaned", { fdi: 36, stage: { model: "filling", step: "cleaned" }, details: { caries: [{ surface: "O", depth: "dentin" }] }, view: "top" }],
    ["Filling: filled (tooth colour)", { fdi: 36, stage: { model: "filling", step: "filled" }, details: { caries: [{ surface: "O", depth: "dentin" }] }, view: "top" }],
    ["Filling: filled, inside", { fdi: 36, stage: { model: "filling", step: "filled", material: "composite" }, details: { caries: [{ surface: "O", depth: "dentin" }] }, view: "inside", labels: true }],
    ["Crown: prep", { fdi: 16, stage: { model: "crown", step: "prep" }, view: "front" }],
    ["Crown: crown", { fdi: 16, stage: { model: "crown", step: "crown" }, view: "front" }],
    ["Scaling: tartar", { fdi: 41, stage: { model: "scaling", step: "calculus" }, view: "front", labels: true }],
    ["Scaling: clean", { fdi: 41, stage: { model: "scaling", step: "clean" }, view: "front" }],
    ["Sealant: fissures", { fdi: 36, stage: { model: "sealant", step: "fissures" }, view: "top", age: 9 }],
    ["Sealant: sealed", { fdi: 36, stage: { model: "sealant", step: "sealed" }, view: "top", age: 9 }],
    ["Extraction: remove", { fdi: 45, stage: { model: "extraction", step: "remove" }, view: "front" }],
    ["Extraction: socket healing", { fdi: 45, stage: { model: "extraction", step: "socket_healing" }, view: "front", labels: true }],
    ["Extraction: healed", { fdi: 45, stage: { model: "extraction", step: "healed" }, view: "front" }],
    ["Wisdom: remove", { fdi: 38, stage: { model: "wisdom_extraction", step: "remove" }, details: { eruption: "impacted", angulation: "mesioangular" }, view: "front" }],
  ]],
  ["Overlays", [
    ["Abscess at the root tip", { fdi: 36, details: { infection: "abscess" }, view: "front", labels: true }],
    ["Infection, inside", { fdi: 21, details: { infection: "infection" }, view: "inside", labels: true }],
    ["Fracture", { fdi: 26, details: { fracture: true }, view: "top" }],
    ["Existing amalgam + crack", { fdi: 47, details: { restorations: [{ kind: "filled", surfaces: ["O", "D"], material: "amalgam" }], fracture: true }, view: "top" }],
    ["Old root filling + crown", { fdi: 36, details: { restorations: [{ kind: "root_canal" }, { kind: "crown", material: "pfm" }] }, view: "inside", labels: true }],
    ["Milk molar 85, abscess", { fdi: 85, details: { infection: "abscess" }, view: "front" }],
  ]],
  ["Every tooth type", types.map((t): Tile => [t, { toothType: t, fdi: Number((t.startsWith("p") ? (t.includes("u") ? "5" : "8") : (t.includes("u") ? "1" : "4")) + t.slice(-1)), view: "front" }]), true],
];

const out = document.getElementById("out"), stage = document.getElementById("stage"), stats = document.getElementById("stats");
const only = new URLSearchParams(location.search).get("only");

async function main(): Promise<void> {
  if (!out || !stage || !stats) return;
  const { mountTooth3d, typeOfFdi } = await import("../index.js");
  const bg = getComputedStyle(document.documentElement).getPropertyValue("--stage").trim() || "#ebe7e1";
  const dark = matchMedia("(prefers-color-scheme: dark)").matches;
  let maxTris = 0, n = 0;
  const cv = document.createElement("canvas");
  stage.appendChild(cv);
  let hd: Tooth3dHandle | null = null;
  const t0 = performance.now();
  for (const [si, [title, tiles, small]] of SECTIONS.entries()) {
    if (only !== null && String(si) !== only) continue;
    const h = document.createElement("h2");
    h.textContent = title;
    const grid = document.createElement("div");
    grid.className = small ? "grid small" : "grid";
    out.append(h, grid);
    for (const [name, o, sub] of tiles) {
      // one canvas and handle for every tile, as the app should do across taps
      const next: Tooth3dOptions = { stage: null, details: {}, labels: false, view: "front", ...o, background: bg, reducedMotion: true };
      const tt = o.toothType ?? (o.fdi !== undefined ? typeOfFdi(o.fdi) : undefined);
      if (tt) next.toothType = tt;
      if (!hd) { hd = mountTooth3d(cv, next); await hd.ready; } else hd.update(next);
      const st = hd.stats();
      maxTris = Math.max(maxTris, st.tris);
      n++;
      const img = new Image();
      img.alt = name;
      img.src = await compose(hd.snapshot(), st.labels, cv, dark);
      await img.decode().catch(() => undefined);
      const notes = hd.spec?.notes.join("; ") ?? "";
      const fig = document.createElement("figure");
      const cap = document.createElement("figcaption");
      cap.textContent = name;
      const sm = document.createElement("small");
      sm.textContent = [sub, notes, `${String(Math.round(st.tris / 1000))}k tris`].filter(Boolean).join(" · ");
      cap.append(sm);
      fig.append(img, cap);
      grid.append(fig);
    }
  }
  hd?.dispose();
  stats.textContent = `${String(n)} scenes, max ${String(maxTris)} visible triangles, ${String(Math.round(performance.now() - t0))} ms`;
  document.body.dataset["done"] = "1";
}

async function compose(url: string, labels: { text: string; x: number; y: number; warn: boolean }[], cv: HTMLCanvasElement, dark: boolean): Promise<string> {
  if (!labels.length) return url;
  const c = document.createElement("canvas"), s = cv.width / Math.max(1, cv.clientWidth);
  c.width = cv.width;
  c.height = cv.height;
  const x = c.getContext("2d");
  const im = new Image();
  im.src = url;
  await im.decode();
  if (!x) return url;
  x.drawImage(im, 0, 0);
  x.scale(s, s);
  x.font = "600 12px system-ui, sans-serif";
  const w = cv.clientWidth;
  const sides: Record<string, typeof labels> = { l: [], r: [] };
  for (const l of labels) (l.x < w / 2 ? sides["l"] : sides["r"])?.push(l);
  for (const [side, arr] of Object.entries(sides)) {
    arr.sort((a, b) => a.y - b.y);
    let last = -99;
    for (const l of arr) {
      const ly = Math.max(l.y, last + 24);
      last = ly;
      const tw = x.measureText(l.text).width + 14;
      const lx = side === "l" ? Math.max(8 + tw, Math.min(l.x - 40, w * 0.22)) : Math.min(w - 8 - tw, Math.max(l.x + 40, w * 0.78));
      x.strokeStyle = l.warn ? "#c62828" : dark ? "rgba(255,255,255,.75)" : "rgba(20,30,28,.7)";
      x.fillStyle = x.strokeStyle;
      x.beginPath(); x.moveTo(l.x, l.y); x.lineTo(lx, ly); x.stroke();
      x.beginPath(); x.arc(l.x, l.y, 2.5, 0, 7); x.fill();
      const bx = side === "l" ? lx - tw - 2 : lx + 2;
      x.fillStyle = l.warn ? "#c62828" : dark ? "rgba(30,38,36,.92)" : "rgba(255,255,255,.92)";
      x.beginPath(); x.roundRect(bx, ly - 10, tw, 20, 10); x.fill();
      x.fillStyle = l.warn ? "#fff" : dark ? "#e8efec" : "#1d2a27";
      x.fillText(l.text, bx + 7, ly + 4);
    }
  }
  return c.toDataURL("image/png");
}

void main();
