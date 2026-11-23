// Fake studio layer of Show patient (present-studio-design §5.1, slice 2a): the same rules the server
// builder (`aarogyam_domain::present::build`) applies, from the same data files. Situations come from
// recorded snapshot fields only; options and outcome words come from the files; prices (slice 2b) from
// the clinic's mapping, only when the caller passes them.

import optionsFile from "../../../../../specialties/dental/present/options.json" with { type: "json" };
import outcomesFile from "../../../../../specialties/dental/present/outcomes.json" with { type: "json" };
import type * as C from "../contract.js";
import type { PresentOption, PresentPrice, PresentSettings, PresentStudio } from "../schemas.js";

interface OptionDef {
  key: string;
  label: string;
  summary: string;
  looks_like: string;
  visits: { min: number; max: number };
  finish?: { min: number; max: number; unit: string };
  look: string;
  outcome?: string;
  comfort: string;
  price_parts?: { procedure: string; material?: string }[];
}
interface OutcomeDef { words?: string; why?: string; source?: string; source_quote?: string }

const situations: Record<string, { title: string; options: OptionDef[] }> = optionsFile.situations;
const comfort: Record<string, string> = optionsFile.comfort;
const outcomes: Record<string, OutcomeDef> = outcomesFile.outcomes;

const permanent = (tooth: number): boolean => tooth >= 11 && tooth <= 48 && tooth % 10 >= 1 && tooth % 10 <= 8;

function situationsOf(t: C.MouthTooth): string[] {
  const keys: string[] = [];
  const caries = (t.problems ?? []).includes("caries");
  if ((caries && t.details?.caries_depth === "near_pulp") || t.details?.infection !== undefined) keys.push("deep_decay");
  if (permanent(t.tooth) && t.tooth % 10 !== 8 && t.finding === "missing") keys.push("missing");
  const eruption = t.details?.eruption;
  if (permanent(t.tooth) && t.tooth % 10 === 8 && (eruption === "impacted" || eruption === "partial" || eruption === "unerupted")) keys.push("impacted_wisdom");
  return keys;
}

function card(o: OptionDef): PresentOption {
  const out = o.outcome === undefined ? undefined : outcomes[o.outcome];
  return {
    key: o.key, label: o.label, summary: o.summary, looks_like: o.looks_like, visits: o.visits,
    ...(o.finish === undefined ? {} : { finish: o.finish }),
    look: o.look,
    ...(out?.words === undefined ? {} : {
      lifespan: {
        words: out.words,
        ...(out.why === undefined ? {} : { why: out.why }),
        ...(out.source !== undefined && out.source_quote !== undefined ? { source: out.source, source_quote: out.source_quote } : {}),
      },
    }),
    comfort: comfort[o.comfort] ?? "",
  };
}

/** The studio layer of a snapshot, as the server builds it. */
export function fakePresentStudio(snapshot: C.MouthSnapshot): PresentStudio {
  return {
    situations: [...snapshot.teeth].sort((a, b) => a.tooth - b.tooth).flatMap((t) =>
      situationsOf(t).flatMap((key) => {
        const def = situations[key];
        return def === undefined ? [] : [{ key, tooth: t.tooth, title: def.title, options: def.options.map(card) }];
      })),
  };
}

/** The seeded procedure and material ids a price key may name. */
const PROCEDURES = new Set(["filling", "inlay", "onlay", "veneer", "crown", "bridge_abutment", "bridge_pontic", "root_canal", "post_core", "core_build_up", "pulpotomy", "implant", "extraction", "sealant", "scaling", "bridge"]);
const MATERIALS = new Set(["zirconia", "pfm", "cast_metal", "composite", "amalgam", "glass_ionomer", "emax", "gold"]);

/** Why a settings body is refused, or undefined when it is fine. `codes` are the clinic's active price codes. */
export function presentSettingsProblem(settings: PresentSettings, codes: readonly string[]): string | undefined {
  for (const [key, code] of Object.entries(settings.price_map)) {
    const [procedure = "", material] = key.split(":");
    if (!PROCEDURES.has(procedure) || (material !== undefined && !MATERIALS.has(material))) return `unknown price key ${key}`;
    if (!codes.includes(code)) return `unknown price code ${code}`;
  }
  return undefined;
}

/** The studio with "from" prices, as the server's `prices` does: an unmapped part gives the option no number. */
export function withPrices(studio: PresentStudio, settings: PresentSettings, list: readonly { code: string; paise: number }[]): PresentStudio {
  const prices: PresentPrice[] = [];
  for (const situation of studio.situations) {
    for (const option of situations[situation.key]?.options ?? []) {
      const parts = option.price_parts ?? [];
      if (parts.length === 0 || prices.some((p) => p.option_key === option.key)) continue;
      const paise = parts.map((part) => {
        const code = (part.material === undefined ? undefined : settings.price_map[`${part.procedure}:${part.material}`]) ?? settings.price_map[part.procedure];
        return list.find((i) => i.code === code)?.paise;
      });
      if (paise.every((p): p is number => p !== undefined)) prices.push({ option_key: option.key, from_paise: paise.reduce((a, b) => a + b, 0) });
    }
  }
  return { ...studio, prices };
}
