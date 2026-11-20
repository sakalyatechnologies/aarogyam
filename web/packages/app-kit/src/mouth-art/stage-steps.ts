// Treatment step ids. specialties/dental/treatment-stages.json (§1.12) is not seeded yet, so the
// step ids are defined here from the design; the stage art's scene keys match them (tested), and
// the server's step `scene` values must use the same ids.

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
export const EXTRA_SCENES = { extraction: ["healed"], wisdom_extraction: ["healed"] } as const;

export const BRUSHING_BANDS = ["general_under_6", "general_6_12", "general_teen", "general_adult"] as const;
export type BrushingBand = (typeof BRUSHING_BANDS)[number];

/** §1.13 detail values (specialties/dental/chart-details.json once P3a seeds it). */
export const DETAIL_VALUES = {
  caries_depth: ["enamel", "dentin", "near_pulp"],
  infection: ["infection", "abscess"],
  bleeding: ["true"],
  pocket_mm: Array.from({ length: 15 }, (_, i) => String(i + 1)),
  mobility: ["0", "1", "2", "3"],
  eruption: ["erupted", "partial", "impacted", "unerupted"],
  angulation: ["vertical", "mesioangular", "distoangular", "horizontal"],
} as const;
