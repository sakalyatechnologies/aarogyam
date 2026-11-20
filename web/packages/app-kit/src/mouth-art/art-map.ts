// specialties/dental/art-map.json (rule 11: data) and the registry of art keys it may point at.
import source from "../../../../../specialties/dental/art-map.json" with { type: "json" };

import { MATERIAL_LOOKS } from "./overlays.js";
import { EXTRA_SCENES, STAGE_MODELS, STAGE_STEPS } from "./stage-steps.js";

export type ArtRef = { art: string } | { text_only: true; label: string };
type Group = "findings" | "procedures" | "materials";
type DetailField = keyof typeof source.details;

export const ART_MAP = source;

const OVERLAY_KINDS = ["caries", "filled", "inlay", "crown", "veneer", "root_canal", "post_core", "core_build_up", "pulpotomy", "implant",
  "bridge_abutment", "bridge_pontic", "missing", "sealant", "fracture", "infection", "abscess", "bleeding", "pocket", "mobility"];
export const ERUPTION_KEYS = ["erupted", ...["partial", "impacted", "unerupted"].flatMap((e) => ["vertical", "mesioangular", "distoangular", "horizontal"].map((a) => `${e}_${a}`))];

/** Every art key that exists in the kit. */
export const ART_KEYS: ReadonlySet<string> = new Set([
  "tooth",
  ...OVERLAY_KINDS.map((k) => `overlay:${k}`),
  ...["enamel", "dentin", "near_pulp"].map((d) => `overlay:caries.${d}`),
  ...[1, 2, 3].map((g) => `overlay:mobility.${String(g)}`),
  ...Object.keys(MATERIAL_LOOKS).map((m) => `material:${m}`),
  ...STAGE_MODELS.flatMap((m) => [`scene:${m}`, ...STAGE_STEPS[m].map((s) => `scene:${m}.${s}`)]),
  ...Object.entries(EXTRA_SCENES).flatMap(([m, list]) => list.map((s) => `scene:${m}.${s}`)),
  ...ERUPTION_KEYS.map((k) => `scene:wisdom_extraction.position.${k}`),
]);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const textOnly = (label: string): ArtRef => ({ text_only: true, label });

function toRef(v: unknown, fallbackLabel: string): ArtRef {
  if (typeof v === "object" && v !== null) {
    if ("art" in v && typeof v.art === "string") return { art: v.art };
    if ("text_only" in v && v.text_only === true) return textOnly("label" in v && typeof v.label === "string" ? v.label : fallbackLabel);
  }
  return textOnly(fallbackLabel);
}

/** Art for a finding, procedure or material id. Clinic-custom (UUID) or unknown ids are text-only. */
export function resolveArt(group: Group, id: string): ArtRef {
  if (UUID.test(id)) return textOnly(source.custom_term.label);
  const table: Record<string, unknown> = source[group];
  return toRef(table[id], source.custom_term.label);
}

/** Art for a §1.13 detail value. */
export function resolveDetail(field: DetailField, value: string): ArtRef {
  const table: Record<string, unknown> = source.details[field];
  return toRef(table[value], value);
}
