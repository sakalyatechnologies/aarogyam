// Detail overlays (§1.13) and existing work drawn on a tooth view. Each overlay becomes a ScenePart:
// layers to hide, layers to add, labels and "not recorded" notes. Nothing is drawn for a detail that
// wasn't recorded.
import { MM, anchorBoxes, type ScenePart } from "./scene.js";
import type { ArtLayer, Box, ToothArt, ViewName } from "./types.js";

export type Surface = "M" | "O" | "D" | "B" | "L";
export type CariesDepth = "enamel" | "dentin" | "near_pulp";

export type Overlay =
  | { kind: "caries"; surface: Surface; depth?: CariesDepth }
  | { kind: "filled"; surfaces: Surface[]; material?: string }
  | { kind: "inlay"; surfaces?: Surface[]; material?: string }
  | { kind: "crown"; material?: string }
  | { kind: "veneer"; material?: string }
  | { kind: "root_canal" }
  | { kind: "post_core" }
  | { kind: "core_build_up" }
  | { kind: "pulpotomy" }
  | { kind: "implant"; material?: string }
  | { kind: "bridge_abutment"; material?: string }
  | { kind: "bridge_pontic"; material?: string }
  | { kind: "missing" }
  | { kind: "sealant" }
  | { kind: "fracture" }
  | { kind: "infection"; type: "infection" | "abscess" }
  | { kind: "bleeding" }
  | { kind: "pocket"; mm: number; side?: "M" | "D" }
  | { kind: "mobility"; grade: 1 | 2 | 3 };

/** Material looks and the paint each one uses. */
export const MATERIAL_LOOKS: Record<string, string> = {
  porcelain: "g:porc", metal: "g:metal", gold: "g:gold", composite: "composite", amalgam: "g:amal",
  glass_ionomer: "glassIonomer", temporary: "temporary", gutta_percha: "g:gp", calcium_hydroxide: "calcium_hydroxide",
  pfm: "g:porc", zirconia: "g:porc", layered_zirconia: "g:porc", emax: "g:porc",
  mta: "mta", titanium: "g:u_ti", zirconia_abutment: "g:u_zr", resin_sealant: "resin", gic_sealant: "glassIonomer",
};
/** Seeded material ids (vocabulary.json) to their look. Unknown or custom ids fall back. */
const MATERIAL_ID_LOOK: Record<string, string> = {
  zirconia: "zirconia", pfm: "pfm", emax: "emax", ceramic: "porcelain", layered_zirconia: "layered_zirconia",
  inlay_onlay: "porcelain", cast_metal: "metal", gold: "gold", composite: "composite", flowable_composite: "composite",
  composite_veneer: "composite", amalgam: "amalgam", glass_ionomer: "glass_ionomer", temporary: "temporary",
  gutta_percha: "gutta_percha", bioceramic_sealer: "gutta_percha", ah_plus_sealer: "gutta_percha",
  calcium_hydroxide: "calcium_hydroxide", mta: "mta", titanium_4_2x10: "titanium", titanium_3_5x11_5: "titanium",
  zirconia_abutment: "zirconia_abutment", resin_sealant: "resin_sealant", gic_sealant: "gic_sealant",
};
/** Paint for a material id or look, with a fallback look. */
export function materialPaint(material: string | undefined, fallback: "porcelain" | "composite"): string {
  const look = material === undefined ? fallback : (MATERIAL_ID_LOOK[material] ?? (material in MATERIAL_LOOKS ? material : fallback));
  return MATERIAL_LOOKS[look] ?? MATERIAL_LOOKS[fallback] ?? "composite";
}

/** Which views can show a surface's decay with its depth. */
export function viewsForSurface(s: Surface): ViewName[] {
  if (s === "B") return ["top", "front"];
  if (s === "L") return ["top"];
  return ["section", "top"];
}

const PULP = ["pulp", "vessels", "nerve"];
const BODY = ["laminaDura", "pdl", "dentin", "tubules", "enamel", "enamelSheen", "dej", ...PULP, "toothEdge"];
const FRONT_TOOTH = ["enamel", "lobe0", "lobe1", "lobe2", "translucency", "enamelSide", "grooveValley", "fissures", "buccalPit",
  "cervicalRidge", "incisalHalo", "neckShade", "specular", "specular2", "crownEdge", "gumShadow", "rootGhost", "rootGhostEdge"];

const L = (n: string, d: string, o: Partial<ArtLayer> = {}): ArtLayer => ({ n, d, ...o });

function cariesLayers(d: string, clip: string, at: string | undefined, neutral: boolean, enamel: boolean): ArtLayer[] {
  if (at !== undefined) {
    const fill = neutral ? "g:u_carN" : enamel ? "g:u_carE" : "g:u_car";
    return [
      L("cariesHalo", d, { s: "cariesHalo", w: 22, o: 0.35, c: clip, at }),
      L("cariesLesion", d, { f: fill, c: clip, at }),
    ];
  }
  return [
    L("cariesHalo", d, { s: neutral ? "cariesHalo" : "cariesBrown", w: 2.4, o: 0.45, c: clip }),
    L("cariesLesion", d, { f: neutral ? "cariesNeutral" : "caries", c: clip }),
    L("cariesRim", d, { s: "cariesMid", w: 0.8, o: 0.7, c: clip }),
  ];
}

/** What tells the ceramics apart on a crown: a metal collar (PFM), an opaque body (zirconia), a see-through edge (layered zirconia, e.max). */
function finishLayers(view: ViewName, material: string | undefined): ArtLayer[] {
  const d = view === "front" ? "@crown" : view === "top" ? "@outline" : "@crownShell";
  switch (material) {
    case "pfm": return [L("pfmCollar", d, { s: "steel", w: 1.1, o: 0.85 })];
    case "zirconia": return [L("zirconiaBody", d, { f: "white", o: 0.28 })];
    case "layered_zirconia": return [L("zirconiaCore", d, { f: "white", o: 0.14 }), L("layeredEdge", d, { f: "tipTrans", o: 0.3 })];
    case "emax": return [L("emaxGlass", d, { f: "translucent", o: 0.3 })];
    default: return [];
  }
}

function crownLook(view: ViewName, paint: string, material?: string): ScenePart {
  const part = crownBase(view, paint);
  const extra = finishLayers(view, material);
  return extra.length === 0 ? part : { ...part, add: [...part.add, ...extra] };
}

function crownBase(view: ViewName, paint: string): ScenePart {
  if (view === "front") return { add: [L("crownCover", "@crown", { f: paint, above: "specular2" }), L("crownGloss", "@crown", { f: "g:gloss", o: 0.7 })], hide: ["grooveValley", "fissures", "buccalPit"] };
  if (view === "top") return { add: [L("crownCover", "@outline", { f: paint.replace("g:porc", "g:porc"), above: "enamel" }), L("fissuresSoft", "@grooves", { s: "shadow", w: 0.7, o: 0.3, c: "crown", above: "grooveValley2" }), L("crownGloss", "@outline", { f: "g:gloss", above: "glints" })], hide: ["fissures", "pits"] };
  return {
    hide: ["enamel", "enamelSheen"],
    add: [L("crownShell", "@crownShell", { f: paint, above: "dej" }), L("crownGloss", "@crownShell", { f: "g:gloss", o: 0.6 }), L("cementLine", "@prep", { s: "cement", w: 0.6, o: 0.8 })],
  };
}

const healedSection: ArtLayer[] = [
  L("healedBone", "@socket", { f: "bone", o: 0.92, above: "gum" }),
  L("healedEdge", "@socket", { s: "boneCortex", w: 1, o: 0.8, dash: [2, 2] }),
  L("ridge", "@ridge", { f: "g:gumCut" }),
];
const fixtureLayers: ArtLayer[] = [
  L("fixture", "#fixture", { f: "g:u_ti", at: "implant", above: "gum" }),
  L("fixtureThreads", "#fixtureThreads", { s: "#5E666E", w: 2.4, o: 0.5, at: "implant" }),
];

/** Overlay -> scene part for one view. Returns an empty part when the view can't show it. */
export function overlayPart(art: ToothArt, view: ViewName, ov: Overlay): ScenePart {
  const empty: ScenePart = { add: [] };
  switch (ov.kind) {
    case "caries": {
      const depth = ov.depth ?? "dentin";
      const notes = ov.depth === undefined ? ["depth_not_recorded"] : [];
      const neutral = ov.depth === undefined;
      if (view === "section") {
        if (ov.surface === "B" || ov.surface === "L") return empty;
        return { add: cariesLayers(`@car.${ov.surface}.${depth}`, "tooth", undefined, neutral, depth === "enamel"), notes };
      }
      if (view === "top") return { add: cariesLayers(`#car.${depth}`, "crown", `surf.${ov.surface}`, neutral, depth === "enamel"), notes };
      if (ov.surface === "L") return empty;
      return { add: cariesLayers(`#car.${depth}`, "crown", `fsurf.${ov.surface}`, neutral, depth === "enamel"), notes };
    }
    case "filled":
    case "inlay": {
      const paint = materialPaint(ov.material, ov.kind === "inlay" ? "porcelain" : "composite");
      const surfaces = ov.surfaces ?? ["O"];
      const add: ArtLayer[] = [];
      for (const s of surfaces) {
        let d: string | undefined, at: string | undefined, clip = "crown";
        if (view === "section") { clip = "tooth"; if (s === "M" || s === "O" || s === "D") d = `@cav.${s}`; }
        else if (view === "top") { if (s === "B" || s === "L") { d = "#cav"; at = `surf.${s}`; } else d = `@cav.${s}`; }
        else if (s === "M" || s === "D") d = `@fcav.${s}`;
        else if (s === "B" || s === "O") { d = "#cav"; at = `fcav.${s}`; }
        if (d === undefined) continue;
        const pos = at === undefined ? {} : { at };
        add.push(L("filling", d, { f: paint, c: clip, ...pos }), L("fillingMargin", d, { s: "compositeEdge", w: at ? 4 : 0.5, o: 0.45, c: clip, ...pos }));
      }
      return { add };
    }
    case "crown":
    case "bridge_abutment":
      return crownLook(view, materialPaint(ov.material, "porcelain"), ov.material);
    case "veneer":
      return view === "front" ? { add: [L("veneer", "@crown", { f: materialPaint(ov.material, "porcelain"), o: 0.96, above: "specular2" }), L("veneerGloss", "@crown", { f: "g:gloss", o: 0.6 })] } : empty;
    case "root_canal":
    case "post_core":
    case "core_build_up":
    case "pulpotomy": {
      if (view === "top") return ov.kind === "pulpotomy" || ov.kind === "root_canal" ? { add: [L("accessSeal", "#cav", { f: "composite", at: "surf.O", c: "crown" }), L("accessMargin", "#cav", { s: "compositeEdge", w: 4, o: 0.4, at: "surf.O", c: "crown" })] } : empty;
      if (view === "front") return ov.kind === "pulpotomy" || ov.kind === "core_build_up" ? empty : { add: [L("guttaGhost", "@canals", { f: "gutta", o: 0.45, c: "belowGum", above: "rootGhostEdge" })] };
      if (ov.kind === "pulpotomy") return { add: [L("mtaChamber", "@chamber", { f: "mta", above: "pulp" }), L("seal", "@access", { f: "composite", c: "tooth" })] };
      if (ov.kind === "core_build_up") return { add: [L("core", "@access", { f: "core", c: "tooth", above: "nerve" }), L("coreEdge", "@access", { s: "compositeEdge", w: 0.45, o: 0.45, c: "tooth" })] };
      const add = [L("core", "@chamber", { f: "core", above: "dej" }), L("gutta", "@canals", { f: "g:gp" }), L("seal", "@access", { f: "composite", c: "tooth" }), L("sealEdge", "@access", { s: "compositeEdge", w: 0.45, o: 0.45, c: "tooth" })];
      if (ov.kind === "post_core") add.push(L("post", "@post", { s: "steel", w: 6 }), L("postShine", "@post", { s: "white", w: 1.4, o: 0.5 }));
      return { hide: PULP, add };
    }
    case "implant": {
      const paint = materialPaint(ov.material, "porcelain");
      if (view === "section") return { hide: BODY, add: [...healedSection.slice(0, 1), ...fixtureLayers, ...healedSection.slice(2), L("abutment", "#abutment", { f: "g:u_ti", at: "abut" }), L("implantCrown", "@crown", { f: paint }), L("implantGloss", "@crown", { f: "g:gloss", o: 0.6 }), L("implantEdge", "@crown", { s: "shadow", w: 0.6, o: 0.45 })] };
      if (view === "front") {
        const c = crownLook(view, paint, ov.material);
        return { hide: [...(c.hide ?? []), "rootGhost", "rootGhostEdge"], add: [...c.add, L("fixtureGhost", "#fixture", { f: "g:u_ti", o: 0.5, at: "implant", c: "belowGum", above: "gumMargin" })] };
      }
      return crownLook(view, paint, ov.material);
    }
    case "bridge_pontic": {
      const paint = materialPaint(ov.material, "porcelain");
      if (view === "section") return { hide: BODY, add: [...healedSection, L("pontic", "@crown", { f: paint }), L("ponticGloss", "@crown", { f: "g:gloss", o: 0.6 }), L("ponticEdge", "@crown", { s: "shadow", w: 0.6, o: 0.45 })] };
      const c = crownLook(view, paint, ov.material);
      return view === "front" ? { hide: [...(c.hide ?? []), "rootGhost", "rootGhostEdge"], add: c.add } : c;
    }
    case "missing":
      if (view === "section") return { hide: BODY, add: healedSection };
      if (view === "front") return { hide: FRONT_TOOTH, add: [L("ridge", "@ridge", { f: "g:gum", above: "gum" })] };
      return { hide: ["*"], add: [L("gap", "@outline", { s: "shadow", w: 0.8, o: 0.45, dash: [2.5, 2] })] };
    case "sealant":
      return view === "top" ? { add: [L("sealant", "@grooves", { s: "resin", w: 4.6, o: 0.82, c: "crown", above: "fissures" }), L("sealantGloss", "@grooves", { s: "white", w: 1.4, o: 0.45, c: "crown" })] } : empty;
    case "fracture": {
      const at = view === "top" ? "surf.O" : "crown";
      const clip = view === "section" ? "tooth" : "crown";
      return { add: [L("crackShadow", "#crack", { s: "crack", w: 7, o: 0.25, at, c: clip }), L("crack", "#crack", { s: "crack", w: 2.6, o: 0.9, at, c: clip }), L("crackLight", "#crack", { s: "white", w: 1.2, o: 0.5, at, c: clip, tr: [1, 0, 0, 1, 2.5, 0] })] };
    }
    case "infection": {
      if (view === "top") return empty;
      const abscess = ov.type === "abscess";
      const anchorsName = "apex";
      if (view === "section") {
        const add = [L("lesion", "#halo", { f: "g:u_halo", at: anchorsName, above: "pdl" })];
        if (abscess) add.push(L("lesion2", "#halo", { f: "g:u_halo", at: anchorsName, tr: [1.25, 0, 0, 1.25, -12.5, -12.5] }), L("pus", "#pus", { f: "g:u_pus", at: anchorsName, o: 0.9 }));
        return { add };
      }
      const add = [L("swelling", "#swelling", { f: "g:u_swell", at: anchorsName, o: abscess ? 0.9 : 0.55, above: "gumMargin" })];
      if (abscess) add.push(L("pus", "#pus", { f: "g:u_pus", at: anchorsName }));
      return { add };
    }
    case "bleeding":
      if (view === "front") return { add: [L("bleedLine", "@gumLine", { s: "blood", w: 1.8, o: 0.85, above: "gumMargin" }), L("drops", "#drops", { f: "g:u_drop", at: "neck" })] };
      if (view === "section") return { add: [L("drops", "#drops", { f: "g:u_drop", at: "neck" })] };
      return empty;
    case "pocket":
      return view === "section" ? pocketPart(art, ov.mm, ov.side ?? "M") : empty;
    case "mobility": {
      if (view === "top") return empty;
      const crown = anchorBoxes(art.anchors.crown)[0];
      if (!crown) return empty;
      const [x, y, w, h] = crown;
      const k = 0.6 + ov.grade * 0.2;
      const arrows: Box = [x + w * (0.5 - 0.32 * k), y + h * 0.22, w * 0.64 * k, h * 0.24];
      const am: [number, number, number, number, number, number] = [arrows[2] / 100, 0, 0, arrows[3] / 100, arrows[0], arrows[1]];
      const add: ArtLayer[] = [
        L("ghostL", "@crown", { s: "markInk", w: 0.7, o: 0.3, tr: [1, 0, 0, 1, -0.6 * ov.grade * MM * 0.5, 0] }),
        L("ghostR", "@crown", { s: "markInk", w: 0.7, o: 0.3, tr: [1, 0, 0, 1, 0.6 * ov.grade * MM * 0.5, 0] }),
        L("arrowsHalo", "#arrowsH", { s: "white", w: 14, o: 0.85, tr: am }),
        L("arrows", "#arrowsH", { f: "markInk", tr: am }),
      ];
      if (ov.grade === 3) {
        const vm: [number, number, number, number, number, number] = [w * 0.0016, 0, 0, h * 0.0055, x + w * 0.5 - w * 0.08, y + h * 0.05];
        add.push(L("arrowsVHalo", "#arrowsV", { s: "white", w: 14, o: 0.85, tr: vm }), L("arrowsV", "#arrowsV", { f: "markInk", tr: vm }));
      }
      return { add, labels: [{ text: `Grade ${String(ov.grade)}`, x: x + w / 2, y: y + h * 0.66, anchor: "middle" }] };
    }
  }
}

/** A periodontal probe and pocket from the gum margin, `mm` deep, on the mesial or distal side. */
function pocketPart(art: ToothArt, mm: number, side: "M" | "D"): ScenePart {
  const a = anchorBoxes(art.anchors[side === "M" ? "pocketM" : "pocketD"])[0];
  if (!a) return { add: [] };
  const [x, y] = a;
  const sg = side === "M" ? 1 : -1;
  const depth = Math.min(15, Math.max(1, mm)) * MM;
  const wedge = `M${f(x)} ${f(y)}L${f(x + sg * 0.9 * MM)} ${f(y)}L${f(x + sg * 0.15 * MM)} ${f(y + depth)}L${f(x)} ${f(y + depth)}Z`;
  const px = x + sg * 0.55 * MM;
  const probe = `M${f(px - 0.25 * MM)} ${f(y - 5 * MM)}L${f(px + 0.25 * MM)} ${f(y - 5 * MM)}L${f(px + 0.2 * MM)} ${f(y + depth)}L${f(px - 0.2 * MM)} ${f(y + depth)}Z`;
  let ticks = "";
  for (let i = 1; i <= Math.ceil(mm); i++) ticks += `M${f(px - 0.6 * MM)} ${f(y + i * MM)}L${f(px + 0.6 * MM)} ${f(y + i * MM)}`;
  return {
    add: [
      L("pocket", wedge, { f: "#5E1A24", o: 0.75, above: "gum" }),
      L("probe", probe, { f: "steel", above: "toothEdge" }),
      L("probeTicks", ticks, { s: "#2F3438", w: 0.5 }),
      L("probeBand", `M${f(px - 0.25 * MM)} ${f(y + 3 * MM)}L${f(px + 0.25 * MM)} ${f(y + 3 * MM)}L${f(px + 0.25 * MM)} ${f(y + 5.5 * MM)}L${f(px - 0.25 * MM)} ${f(y + 5.5 * MM)}Z`, { f: "#2F3438", o: 0.8 }),
    ],
    labels: [{ text: `${String(mm)} mm`, x: px + sg * 1.2 * MM, y: y + depth + 2.6 * MM, anchor: "middle" }],
  };
}
const f = (v: number) => String(Math.round(v * 10) / 10);
