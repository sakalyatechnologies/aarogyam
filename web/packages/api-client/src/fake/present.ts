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
  plan_models?: string[];
  is_wait?: boolean;
}
interface OutcomeDef { words?: string; why?: string; source?: string; source_quote?: string }

const situations: Record<string, { title: string; if_wait?: { stage: string; words: string }[]; options: OptionDef[] }> = optionsFile.situations;
const comfort: Record<string, string> = optionsFile.comfort;
const outcomes: Record<string, OutcomeDef> = outcomesFile.outcomes;

const permanent = (tooth: number): boolean => tooth >= 11 && tooth <= 48 && tooth % 10 >= 1 && tooth % 10 <= 8;

function situationsOf(t: C.MouthTooth): string[] {
  const keys: string[] = [];
  const caries = (t.problems ?? []).includes("caries");
  if (t.details?.infection !== undefined) keys.push("infection");
  else if (caries && t.details?.caries_depth === "near_pulp") keys.push("deep_decay");
  if (permanent(t.tooth) && t.tooth % 10 !== 8 && t.finding === "missing") keys.push("missing");
  const eruption = t.details?.eruption;
  if (permanent(t.tooth) && t.tooth % 10 === 8 && (eruption === "impacted" || eruption === "partial" || eruption === "unerupted")) keys.push("impacted_wisdom");
  return keys;
}

/** The one situation a planned treatment points at when nothing recorded shows one (the server's rule). */
function situationOfPlan(t: C.MouthTooth): string | undefined {
  for (const tr of t.treatments ?? []) {
    if (tr.state !== "planned" && tr.state !== "in_progress") continue;
    if (tr.model === "root_canal" && permanent(t.tooth)) return "deep_decay";
    if ((tr.model === "implant" || tr.model === "bridge") && permanent(t.tooth) && t.tooth % 10 !== 8) return "missing";
    if ((tr.model === "extraction" || tr.model === "wisdom_extraction") && permanent(t.tooth) && t.tooth % 10 === 8) return "impacted_wisdom";
  }
  return undefined;
}

const underWay = (t: C.MouthTooth): boolean => (t.treatments ?? []).some((tr) => tr.state === "planned" || tr.state === "in_progress");
const matchesPlan = (o: OptionDef, t: C.MouthTooth): boolean =>
  (t.treatments ?? []).some((tr) => (tr.state === "planned" || tr.state === "in_progress") && (o.plan_models ?? []).includes(tr.model));

function card(o: OptionDef, suggested: boolean): PresentOption {
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
    ...(suggested ? { suggested: true } : {}),
  };
}

/** The studio layer of a snapshot, as the server builds it. */
export function fakePresentStudio(snapshot: C.MouthSnapshot): PresentStudio {
  return {
    situations: [...snapshot.teeth].sort((a, b) => a.tooth - b.tooth).flatMap((t) =>
      (situationsOf(t).length > 0 ? situationsOf(t) : [situationOfPlan(t) ?? ""]).flatMap((key) => {
        const def = situations[key];
        if (def === undefined) return [];
        const first = def.options.findIndex((o) => matchesPlan(o, t));
        const cards = def.options.flatMap((o, i) => (underWay(t) && o.is_wait === true ? [] : [card(o, i === first)]));
        const at = cards.findIndex((c) => c.suggested === true);
        const pick = cards[at];
        const options = at > 0 && pick !== undefined ? [pick, ...cards.slice(0, at), ...cards.slice(at + 1)] : cards;
        const if_wait = def.if_wait ?? [];
        return [{ key, tooth: t.tooth, title: def.title, ...(situationsOf(t).length === 0 ? { from_plan: true } : {}), ...(if_wait.length === 0 ? {} : { if_wait }), options }];
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
