// Aarogyam-owned. The four drafts, in the order the index lists them.
import { dpa } from "./dpa";
import { notice } from "./notice";
import { privacy } from "./privacy";
import { terms } from "./terms";
import type { LegalDoc } from "./types";

export const LEGAL_DOCS: readonly LegalDoc[] = [privacy, terms, dpa, notice];

export { legalPath, type LegalSlug } from "./paths";
export { DRAFT_NOTICE } from "./types";
export type { Block, LegalDoc, Section } from "./types";
