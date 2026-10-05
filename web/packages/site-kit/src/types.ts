import type { SitePage, SitePhoto } from "@aarogyam/api-client";

export type { SitePage, SitePhoto };

/** The pages of a multi-page site. A one-page site shows every section on `home`. */
export type PageId = "home" | "about" | "services" | "gallery" | "contact";

export const PAGES: readonly PageId[] = ["home", "about", "services", "gallery", "contact"];

export type PhotoKind = SitePhoto["kind"];

/** What the owner can change by clicking text in the preview. */
export interface EditApi {
  /** Called when the owner finishes editing text at `path`, such as `hero.headline`. */
  setText: (path: string, value: string) => void;
  /** Called when the owner wants to add or change a picture. */
  pickPhoto: (kind: PhotoKind, current?: SitePhoto | null) => void;
}

/** Everything a section needs besides the page data. */
export interface SiteContext {
  site: SitePage;
  page: PageId;
  /** Whether text and pictures can be edited in place. */
  editing: boolean;
  /** Where the booking page lives; `null` when it cannot be shown. */
  bookingUrl: string | null;
  /** The link for a page: `/about` on the live site, `#` in the preview. */
  hrefFor: (page: PageId) => string;
  /** Moves to a page; the live site changes the address, the preview its state. */
  goto: (page: PageId) => void;
  /** Put before picture addresses, for a preview on another host. */
  assetBase: string;
}

/** Section props shared by every design. */
export interface SectionProps {
  ctx: SiteContext;
  /** Show a short version with a link to the full page. */
  teaser?: boolean | undefined;
}

export type Layout = SitePage["design"]["layout"];
