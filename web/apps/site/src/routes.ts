import { PAGES, type PageId } from "@aarogyam/site-kit";

const PATHS: Record<PageId, string> = {
  home: "/",
  about: "/about",
  services: "/services",
  gallery: "/gallery",
  contact: "/contact",
};

export function hrefFor(page: PageId): string {
  return PATHS[page];
}

/** The page for an address; anything unknown shows the home page. */
export function pageFor(pathname: string): PageId {
  const clean = pathname.replace(/\/+$/, "") || "/";
  return PAGES.find((page) => PATHS[page] === clean) ?? "home";
}
