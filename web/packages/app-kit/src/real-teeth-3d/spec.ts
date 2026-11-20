// Inputs of the 3D tooth detail and their pure resolution into a scene spec (no three.js). Step ids and
// detail values are the 2D kit's (mouth-art/stage-steps.ts), so the same input drives 2D and 3D.
import type { Angulation, Eruption } from "../mouth-art/eruption.js";
import type { CariesDepth, Overlay, Surface } from "../mouth-art/overlays.js";
import { shadeForAge, type Shade } from "../mouth-art/palette.js";
import { STAGE_STEPS, type StageModel } from "../mouth-art/stage-steps.js";
import { TOOTH_TYPES, type ToothType } from "../mouth-art/types.js";

export type View = "front" | "top" | "inside";
export type Infection = "infection" | "abscess";

/** §1.13 details recorded on the tooth. Only recorded fields are drawn. */
export interface Tooth3dDetails {
  caries?: { surface: Surface; depth?: CariesDepth }[];
  infection?: Infection;
  /** Shorthand for `infection: "abscess"`. */
  abscess?: boolean;
  eruption?: Eruption;
  angulation?: Angulation;
  fracture?: boolean;
  /** Existing work, as the 2D kit's overlays (filled, crown, root_canal, implant, sealant, ...). */
  restorations?: Overlay[];
  /** Drawn by the caller as 2D badges (see `badges` on the resolved scene). */
  bleeding?: boolean;
  pocket_mm?: number;
  mobility?: 0 | 1 | 2 | 3;
}

export interface Tooth3dStage {
  model: StageModel;
  step: string;
  /** Filling or crown material id (vocabulary.json), when known. */
  material?: string;
}

export interface Tooth3dOptions {
  /** 2D kit tooth type; derived from `fdi` when absent. */
  toothType?: ToothType;
  fdi?: number;
  shade?: Shade;
  age?: number;
  stage?: Tooth3dStage | null;
  details?: Tooth3dDetails;
  view?: View;
  labels?: boolean;
  reducedMotion?: boolean;
  /** CSS colour behind the tooth; transparent when absent. */
  background?: string | null;
  /** Drag to turn the tooth (default true). */
  interactive?: boolean;
}

export type Look = "composite" | "amalgam" | "temporary" | "ceramic" | "metal" | "gold" | "glass_ionomer";
export type CavityState = "decay" | "clean" | "filled";
export interface Cavity { surface: Surface; depth: CariesDepth; state: CavityState; look: Look }
export type Site = "tooth" | "socket" | "healed" | "implant" | "wisdom";
export interface Badge { kind: "bleeding" | "pocket" | "mobility"; value: number; label: string }

/** Everything the geometry needs, resolved from the options. */
export interface SceneSpec {
  type: ToothType;
  upper: boolean;
  mirrored: boolean;
  primary: boolean;
  shade: Shade;
  site: Site;
  cavities: Cavity[];
  /** Pulp state: vital pulp, emptied canals, medicine inside, or root filled. */
  canal: "pulp" | "open" | "medicament" | "filled";
  /** Access cavity: none, open, temporary filling or core filling. */
  access: "none" | "open" | "temporary" | "core";
  crown: "none" | "prep" | "crown" | "veneer";
  crownLook: Look;
  calculus: boolean;
  gumInflamed: boolean;
  fissureStain: boolean;
  sealant: boolean;
  /** Implant parts shown: 1 post, 2 + abutment, 3 + crown. */
  implant: 0 | 1 | 2 | 3;
  /** The tooth is being lifted out (extraction "remove"). */
  lift: boolean;
  infection: Infection | null;
  fracture: boolean;
  wisdom: { eruption: Eruption; angulation: Angulation; neighbor: ToothType } | null;
  view: View;
  cut: "z" | "x";
  badges: Badge[];
  notes: string[];
  /** Stable key of the geometry (everything except view, labels and motion). */
  key: string;
}

export const VIEWS: readonly View[] = ["front", "top", "inside"];

/** FDI number to tooth type (the 2D kit's naming). */
export function typeOfFdi(fdi: number): ToothType | undefined {
  const q = Math.floor(fdi / 10), p = fdi % 10;
  const upper = q === 1 || q === 2 || q === 5 || q === 6, prim = q >= 5 && q <= 8;
  if (q < 1 || q > 8 || p < 1 || p > (prim ? 5 : 8)) return undefined;
  const key = `${prim ? "p" : ""}${upper ? "u" : "l"}${String(p)}`;
  return TOOTH_TYPES.find((t) => t === key);
}

const LOOK_OF: Record<string, Look> = {
  composite: "composite", flowable_composite: "composite", composite_veneer: "composite", resin_sealant: "composite",
  glass_ionomer: "glass_ionomer", gic_sealant: "glass_ionomer", amalgam: "amalgam", temporary: "temporary",
  zirconia: "ceramic", pfm: "ceramic", emax: "ceramic", ceramic: "ceramic", layered_zirconia: "ceramic", inlay_onlay: "ceramic",
  porcelain: "ceramic", cast_metal: "metal", metal: "metal", gold: "gold",
};
/** Look of a material id; unknown and clinic-custom ids fall back. */
export function lookOf(material: string | undefined, fallback: Look): Look {
  return (material !== undefined ? LOOK_OF[material] : undefined) ?? fallback;
}

/** Whether a step id belongs to a model (the 2D kit's ids, plus the extra "healed" scene). */
export function isStep(model: StageModel, step: string): boolean {
  const steps: readonly string[] = STAGE_STEPS[model];
  return steps.includes(step) || (step === "healed" && (model === "extraction" || model === "wisdom_extraction"));
}

const NEIGHBOR: Partial<Record<ToothType, ToothType>> = { l8: "l7", u8: "u7", l7: "l6", u7: "u6", l6: "l5", u6: "u5", l5: "l4", u5: "u4", l3: "l2", u3: "u2" };

/** Resolves options into the scene spec. Throws on an unknown tooth or step. */
export function resolveScene(o: Tooth3dOptions): SceneSpec {
  const type = o.toothType ?? (o.fdi !== undefined ? typeOfFdi(o.fdi) : undefined);
  if (!type) throw new Error("real-teeth-3d: unknown tooth");
  const q = o.fdi !== undefined ? Math.floor(o.fdi / 10) : 0;
  const primary = type.startsWith("p");
  const d = o.details ?? {};
  const stage = o.stage ?? null;
  if (stage && !isStep(stage.model, stage.step)) throw new Error(`real-teeth-3d: unknown step ${stage.model}/${stage.step}`);
  const notes: string[] = [];
  const s: SceneSpec = {
    type, upper: type.includes("u"), mirrored: [2, 3, 6, 7].includes(q), primary,
    shade: o.shade ?? shadeForAge(o.age, primary), site: "tooth", cavities: [], canal: "pulp", access: "none",
    crown: "none", crownLook: "ceramic", calculus: false, gumInflamed: false, fissureStain: false, sealant: false,
    implant: 0, lift: false, infection: d.infection ?? (d.abscess ? "abscess" : null), fracture: d.fracture === true,
    wisdom: null, view: o.view ?? "front", cut: "z", badges: [], notes, key: "",
  };
  const caries = (d.caries ?? []).map((c): Cavity => {
    if (!c.depth) notes.push("Illustration: depth not recorded");
    return { surface: c.surface, depth: c.depth ?? "dentin", state: "decay", look: "composite" };
  });
  // existing work first; the stage step then takes over what it treats
  for (const r of d.restorations ?? []) applyRestoration(s, r);
  s.cavities.push(...caries);
  const m = stage?.model, step = stage?.step;
  const look = (fb: Look): Look => lookOf(stage?.material, fb);
  if (m === "root_canal") {
    s.cavities = s.cavities.filter((c) => c.state === "filled" && c.surface !== "O");
    s.canal = step === "access_clean" ? "open" : step === "dressing" ? "medicament" : "filled";
    s.access = step === "access_clean" ? "open" : step === "dressing" ? "temporary" : "core";
    if (step === "crown") { s.crown = "crown"; s.crownLook = look("ceramic"); s.cavities = []; }
  } else if (m === "filling") {
    const cav = caries.length ? caries : [{ surface: (s.type.match(/[123]$/) ? "M" : "O") satisfies Surface, depth: "dentin", state: "decay", look: "composite" } satisfies Cavity];
    if (!caries.length) notes.push("Illustration: depth not recorded");
    const state: CavityState = step === "decay" ? "decay" : step === "cleaned" ? "clean" : "filled";
    s.cavities = [...s.cavities.filter((c) => c.state === "filled"), ...cav.map((c) => ({ ...c, state, look: look("composite") }))];
  } else if (m === "crown") {
    s.cavities = [];
    s.crown = step === "prep" ? "prep" : "crown";
    s.crownLook = look("ceramic");
  } else if (m === "scaling") {
    s.calculus = step === "calculus";
    s.gumInflamed = step === "calculus";
  } else if (m === "sealant") {
    s.fissureStain = step === "fissures";
    s.sealant = step === "sealed";
  } else if (m === "implant") {
    toGap(s, "implant");
    s.implant = step === "post" ? 1 : step === "abutment" ? 2 : 3;
    s.crownLook = look("ceramic");
  } else if (m === "extraction") {
    if (step === "remove") s.lift = true;
    else toGap(s, step === "healed" ? "healed" : "socket");
  }
  const wantsWisdom = m === "wisdom_extraction" || (d.eruption !== undefined && d.eruption !== "erupted");
  const neighbor = NEIGHBOR[type];
  if (wantsWisdom && neighbor && !primary) {
    if (d.eruption === undefined) notes.push("Illustration: position not recorded");
    s.wisdom = { eruption: d.eruption ?? "impacted", angulation: d.eruption === "erupted" ? "vertical" : (d.angulation ?? (d.eruption ? "vertical" : "mesioangular")), neighbor };
    s.site = "wisdom";
    if (m === "wisdom_extraction") {
      if (step === "remove") s.lift = true;
      if (step === "socket_healing" || step === "healed") { s.site = step === "healed" ? "healed" : "socket"; s.wisdom = null; }
    }
  }
  if (s.site !== "tooth" && s.site !== "wisdom") { s.infection = null; s.fracture = false; }
  if (d.bleeding) s.badges.push({ kind: "bleeding", value: 1, label: "Gums bleed here" });
  if (d.pocket_mm !== undefined) s.badges.push({ kind: "pocket", value: d.pocket_mm, label: `Pocket ${String(d.pocket_mm)} mm` });
  if (d.mobility) s.badges.push({ kind: "mobility", value: d.mobility, label: `${primary ? "Loose milk tooth" : "Loose"}, grade ${String(d.mobility)}` });
  const anterior = /[123]$/.test(type);
  const bl = s.cavities.length > 0 && s.cavities.every((c) => c.surface === "B" || c.surface === "L");
  s.cut = bl || (anterior && (s.canal !== "pulp" || s.crown !== "none")) ? "x" : "z";
  s.notes = [...new Set(notes)];
  s.key = JSON.stringify(s, (k, v: unknown) => (k === "view" || k === "badges" || k === "notes" || k === "key" ? undefined : v));
  return s;
}

function toGap(s: SceneSpec, site: Site): void {
  s.site = site;
  s.cavities = [];
  s.canal = "pulp";
  s.access = "none";
  s.crown = "none";
}

function applyRestoration(s: SceneSpec, r: Overlay): void {
  switch (r.kind) {
    case "filled":
    case "inlay":
      for (const surface of r.surfaces ?? ["O"]) s.cavities.push({ surface, depth: "dentin", state: "filled", look: lookOf(r.material, r.kind === "inlay" ? "ceramic" : "composite") });
      break;
    case "crown":
    case "bridge_abutment":
      s.crown = "crown";
      s.crownLook = lookOf(r.material, "ceramic");
      break;
    case "veneer":
      s.crown = "veneer";
      s.crownLook = lookOf(r.material, "ceramic");
      break;
    case "root_canal":
    case "post_core":
    case "core_build_up":
      s.canal = "filled";
      s.access = "core";
      break;
    case "pulpotomy":
      s.access = "core";
      break;
    case "implant":
      toGap(s, "implant");
      s.implant = 3;
      s.crownLook = lookOf(r.material, "ceramic");
      break;
    case "bridge_pontic":
    case "missing":
      toGap(s, "healed");
      break;
    case "sealant":
      s.sealant = true;
      break;
    case "fracture":
      s.fracture = true;
      break;
    case "infection":
      s.infection = r.type;
      break;
    case "caries":
      s.cavities.push({ surface: r.surface, depth: r.depth ?? "dentin", state: "decay", look: "composite" });
      break;
    case "bleeding":
    case "pocket":
    case "mobility":
      break;
  }
}
