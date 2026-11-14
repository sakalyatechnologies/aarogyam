import type { FamilyRelation } from "@aarogyam/api-client";

/** The six relations the API knows, in the order a desk reaches for them. */
export const RELATION_OPTIONS: readonly { value: FamilyRelation; label: string }[] = [
  { value: "child", label: "Child" },
  { value: "spouse", label: "Spouse" },
  { value: "parent", label: "Parent" },
  { value: "sibling", label: "Sibling" },
  { value: "guardian", label: "Guardian" },
  { value: "other", label: "Other" },
];

export function relationLabel(relation: string): string {
  return RELATION_OPTIONS.find((o) => o.value === relation)?.label ?? relation;
}
