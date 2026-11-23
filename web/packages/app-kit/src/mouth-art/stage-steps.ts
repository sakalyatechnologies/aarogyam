// Stage art ids and how they meet the data files (§1.12, §1.13).
// - STAGE_STEPS are the art kit's own scene keys (generated art, tested against the gen files).
// - SCENE_ART maps every server step `scene` in specialties/dental/treatment-stages.json to one of
//   them; the coverage test reads that file and fails on a scene with no art.
// - DETAIL_VALUES match specialties/dental/chart-details.json (tested); chip labels are read from it.
import details from "../../../../../specialties/dental/chart-details.json" with { type: "json" };

export const STAGE_STEPS = {
  root_canal: ["access_clean", "dressing", "obturation", "crown"],
  filling: ["decay", "cleaned", "filled"],
  extraction: ["remove", "socket_healing"],
  wisdom_extraction: ["position", "remove", "socket_healing"],
  crown: ["prep", "crown"],
  scaling: ["calculus", "clean"],
  implant: ["post", "abutment", "crown"],
  sealant: ["fissures", "sealed"],
} as const;

export type StageModel = keyof typeof STAGE_STEPS;
export const STAGE_MODELS: readonly StageModel[] = ["root_canal", "filling", "extraction", "wisdom_extraction", "crown", "scaling", "implant", "sealant"];

/** Extra scenes that are not steps: the healed gap (also used for a missing tooth). */
export const EXTRA_SCENES = { extraction: ["healed"], wisdom_extraction: ["day1", "week1", "healed"] } as const;

export const BRUSHING_BANDS = ["general_under_6", "general_6_12", "general_teen", "general_adult"] as const;
export type BrushingBand = (typeof BRUSHING_BANDS)[number];

/**
 * Server step scene (treatment-stages.json `steps[].scene`) -> art `model.step`, or "tooth" for a
 * step drawn on the plain tooth (numbing before an extraction).
 */
export const SCENE_ART: Readonly<Record<string, string>> = {
  rct_access: "root_canal.access_clean", rct_dressing: "root_canal.dressing", rct_fill: "root_canal.obturation", rct_crown: "root_canal.crown",
  filling_clean: "filling.cleaned", filling_fill: "filling.filled",
  extraction_numb: "tooth", extraction_remove: "extraction.remove", extraction_heal: "extraction.socket_healing",
  wisdom_numb: "wisdom_extraction.position", wisdom_remove: "wisdom_extraction.remove", wisdom_heal: "wisdom_extraction.socket_healing",
  crown_prepare: "crown.prep", crown_fit: "crown.crown",
  scaling_clean: "scaling.calculus", scaling_polish: "scaling.clean",
  implant_place: "implant.post", implant_heal: "implant.abutment", implant_crown: "implant.crown",
};

const isModel = (m: string): m is StageModel => m in STAGE_STEPS;

/** The art for a server step scene: a stage model and step, or undefined for the plain tooth or an unknown scene. */
export function sceneArt(scene: string): { model: StageModel; step: string } | undefined {
  const key = SCENE_ART[scene];
  if (key === undefined || key === "tooth") return undefined;
  const [model = "", step = ""] = key.split(".");
  return isModel(model) ? { model, step } : undefined;
}

const fields = details.fields;
/** §1.13 detail values; the coverage test checks they equal specialties/dental/chart-details.json. */
export const DETAIL_VALUES = {
  caries_depth: ["enamel", "dentin", "near_pulp"],
  infection: ["infection", "abscess"],
  bleeding: ["true"],
  pocket_mm: Array.from({ length: 15 }, (_, i) => String(i + 1)),
  mobility: ["0", "1", "2", "3"],
  eruption: ["erupted", "partial", "impacted", "unerupted"],
  angulation: ["vertical", "mesioangular", "distoangular", "horizontal"],
} as const;

/** Chip labels for the charting chips (chart-details.json `chips`). */
export const DETAIL_CHIPS = {
  caries_depth: fields.caries_depth.chips,
  infection: fields.infection.chips,
  eruption: fields.eruption.chips,
  angulation: fields.angulation.chips,
} as const;

/**
 * Callout labels on stage art (§1.12): art step -> [layer name in that stage scene, label, sub?].
 * A sub of "{material}" is the recorded material's words (none when not recorded). Tested against the gen files.
 */
export const STAGE_CALLOUTS: Readonly<Record<string, readonly (readonly [string, string, string?])[]>> = {
  "root_canal.access_clean": [["canalVoid", "Cleaned, empty canal"], ["accessVoid", "Opening to reach the canal"]],
  "root_canal.dressing": [["medCanals", "Medicine inside", "{material}"], ["tempFilling", "Temporary filling"]],
  "root_canal.obturation": [["gutta", "Root filling"], ["core", "Filling on top"]],
  "root_canal.crown": [["crownShell", "Crown"], ["gutta", "Root filling"]],
  "filling.decay": [["cariesLesion", "Decay"]],
  "filling.cleaned": [["cavity", "Decay cleaned out"]],
  "filling.filled": [["filling", "Filling"]],
  "crown.prep": [["prepTooth", "Tooth shaped"], ["originalOutline", "Old outline"]],
  "crown.crown": [["crownShell", "Crown"]],
  "extraction.remove": [["socket", "Empty socket"]],
  "extraction.socket_healing": [["clot", "Healing"]],
  "wisdom_extraction.remove": [["socket", "Empty socket"]],
  "wisdom_extraction.socket_healing": [["clot", "Healing"]],
  "implant.post": [["fixture", "Implant post"]],
  "implant.abutment": [["abutment", "Connector"], ["fixture", "Implant post"]],
  "implant.crown": [["implantCrown", "Crown"], ["fixture", "Implant post"]],
  "scaling.calculus": [["calculus", "Tartar"], ["gumInflamed", "Swollen gum"]],
  "scaling.clean": [["gumHealthy", "Healthier gum"]],
  "sealant.fissures": [["stain", "Deep grooves"]],
  "sealant.sealed": [["sealant", "Sealant"]],
};
