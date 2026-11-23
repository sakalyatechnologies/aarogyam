// Fake "What we discussed" (present-studio-design §10, §12.5): the rules of the server's
// `aarogyam_domain::present_discussion`, from the same data files. Append-only: a save supersedes the
// current row for the visit, tooth and situation; a wrong row is marked entered in error.

import materialsFile from "../../../../../specialties/dental/present/materials.json" with { type: "json" };
import optionsFile from "../../../../../specialties/dental/present/options.json" with { type: "json" };
import type { NewPresentDiscussion, PresentDiscussion } from "../schemas.js";

const TOPICS = ["implant", "wisdom", "bridge", "scaling", "veneer"];
// braces and aligners are an example-arch case only until their procedures are seeded (F8)
const BLOCKED = ["braces", "aligners", "orthodontic_fixed"];

const situations: Record<string, { options: { key: string }[] }> = optionsFile.situations;
const groups: Record<string, { materials: { key: string }[] }> = materialsFile.groups;
const optionKeys = new Set(Object.values(situations).flatMap((s) => s.options.map((o) => o.key)));
const materialKeys = new Set(Object.values(groups).flatMap((g) => g.materials.map((m) => m.key)));

export interface FakeDiscussion {
  clinic_id: string;
  visit_id: string;
  status: "current" | "superseded" | "entered_in_error";
  row: PresentDiscussion;
}

/** The first problem with a discussion, in words, or `undefined`. */
export function discussionProblem(input: NewPresentDiscussion): string | undefined {
  const tooth = input.tooth;
  if (tooth != null && !((tooth >= 11 && tooth <= 48 && tooth % 10 >= 1 && tooth % 10 <= 8) || (tooth >= 51 && tooth <= 85 && tooth % 10 >= 1 && tooth % 10 <= 5))) return "not a valid tooth number";
  if (!(input.situation in situations) && !TOPICS.includes(input.situation)) return "unknown situation";
  if (input.options.length < 1 || input.options.length > 12) return "record between 1 and 12 options";
  const seen = new Set<string>();
  for (const o of input.options) {
    if (BLOCKED.includes(o.key)) return "this option is not available yet";
    if (!optionKeys.has(o.key)) return "unknown option";
    if (o.material != null && !materialKeys.has(o.material)) return "unknown material";
    if (seen.has(o.key)) return "each option once, and at most one preferred";
    seen.add(o.key);
  }
  if (input.options.filter((o) => o.preferred === true).length > 1) return "each option once, and at most one preferred";
  return undefined;
}
