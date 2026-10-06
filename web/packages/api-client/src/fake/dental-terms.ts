/** The fake API's dental vocabulary: the seeded terms (a copy of specialties/dental/vocabulary.json) and each clinic's additions. */

import type * as C from "../contract.js";

export interface FakeDentalTerm {
  id: string;
  clinic_id: string;
  kind: C.DentalTermKind;
  label: string;
}

const seed = (kind: C.DentalTermKind, terms: readonly (readonly [string, string])[]): C.DentalTerm[] =>
  terms.map(([id, label]) => ({ id, kind, label, own: false }));

export const SEEDED_TERMS: readonly C.DentalTerm[] = [
  ...seed("procedure", [
    ["filling", "Filling"],
    ["inlay", "Inlay"],
    ["onlay", "Onlay"],
    ["veneer", "Veneer"],
    ["crown", "Crown"],
    ["bridge_abutment", "Bridge abutment"],
    ["bridge_pontic", "Bridge pontic"],
    ["root_canal", "Root canal treatment"],
    ["post_core", "Post and core"],
    ["core_build_up", "Core build-up"],
    ["pulpotomy", "Pulpotomy"],
    ["implant", "Implant"],
    ["extraction", "Extraction"],
    ["sealant", "Pit and fissure sealant"],
    ["scaling", "Scaling"],
  ]),
  ...seed("material", [
    ["zirconia", "Zirconia"],
    ["pfm", "PFM (porcelain fused to metal)"],
    ["cast_metal", "Metal (cast)"],
    ["composite", "Composite"],
    ["amalgam", "Amalgam"],
    ["glass_ionomer", "Glass ionomer"],
    ["emax", "e.max (lithium disilicate)"],
    ["gold", "Gold"],
    ["ceramic", "Ceramic"],
    ["temporary", "Temporary"],
  ]),
];

/** The clinic's list: seeded first, then its own by label. */
export function clinicTerms(own: readonly FakeDentalTerm[] | undefined, clinicId: string): C.DentalTerm[] {
  const mine = (own ?? [])
    .filter((t) => t.clinic_id === clinicId)
    .map((t): C.DentalTerm => ({ id: t.id, kind: t.kind, label: t.label, own: true }))
    .sort((a, b) => a.kind.localeCompare(b.kind) || a.label.toLowerCase().localeCompare(b.label.toLowerCase()));
  return [...SEEDED_TERMS, ...mine];
}
