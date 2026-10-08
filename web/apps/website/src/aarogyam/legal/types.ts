// Aarogyam-owned (not part of the Lovable export). The legal pages are data, rendered by LegalPage.
import type { LegalSlug } from "./paths";

/** What a block of a legal page is. Text may hold [placeholders]; the page highlights them. */
export type Block =
  | { kind: "p"; text: string }
  | { kind: "ul"; items: readonly string[] }
  | { kind: "ol"; items: readonly string[] }
  | { kind: "table"; head: readonly string[]; rows: readonly (readonly string[])[] }
  | { kind: "note"; text: string };

export interface Section {
  id: string;
  title: string;
  blocks: readonly Block[];
}

export interface LegalDoc {
  /** The page path without the slash, such as `privacy`. */
  slug: LegalSlug;
  title: string;
  /** One line under the title: who the page is for. */
  audience: string;
  /** What the page is, for the index and the meta description. */
  summary: string;
  sections: readonly Section[];
}

/** The words every legal page opens with. A test checks that no page leaves them out. */
export const DRAFT_NOTICE = "Draft — needs review by a lawyer before launch";
