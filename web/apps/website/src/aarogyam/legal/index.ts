// Aarogyam-owned. The drafts, in the order the index lists them.
import { accountDeletion } from "./account-deletion";
import { dpa } from "./dpa";
import { notice } from "./notice";
import { privacy } from "./privacy";
import { support } from "./support";
import { terms } from "./terms";
import type { LegalDoc } from "./types";

export const LEGAL_DOCS: readonly LegalDoc[] = [privacy, terms, dpa, notice, accountDeletion, support];

export { legalPath, type LegalSlug } from "./paths";
export { DRAFT_NOTICE } from "./types";
export type { Block, LegalDoc, Section } from "./types";
