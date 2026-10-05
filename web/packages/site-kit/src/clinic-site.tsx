import { useEffect, useMemo, useRef, type CSSProperties, type ReactNode } from "react";

import { fontPairing, paletteOf, templateInfo, type TemplateId } from "./catalog.js";
import { EditProvider } from "./edit.js";
import { PhoneIcon } from "./icons.js";
import { prettyPhone, telHref } from "./format.js";
import { BookLink } from "./parts.js";
import { About, CallToAction, Contact, Doctors, Gallery, Reviews, Services } from "./sections.js";
import { TEMPLATE_PARTS } from "./templates.js";
import type { EditApi, PageId, SectionProps, SiteContext, SitePage } from "./types.js";

export interface ClinicSiteProps {
  site: SitePage;
  /** The page shown on a multi-page site; ignored on a one-page site. */
  page?: PageId;
  /** Called when a visitor opens another page. */
  onNavigate?: (page: PageId) => void;
  /** The link for a page; defaults to `#`. */
  hrefFor?: (page: PageId) => string;
  /** Where the booking flow is; `null` shows the call-to-book message. */
  bookingUrl?: string | null;
  /** Present in the portal's preview: text and pictures become editable. */
  edit?: EditApi;
  /** Put before picture addresses when the pictures live on another host. */
  assetBase?: string;
  className?: string;
}

/** Loads the fonts of the chosen pairing once. Until they arrive the system fonts show. */
function useFonts(id: string): void {
  const href = fontPairing(id).href;
  useEffect(() => {
    if (document.head.querySelector(`link[href="${href}"]`) !== null) {
      return;
    }
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    document.head.append(link);
  }, [href]);
}

/** Fades sections in as they scroll into view; skipped when motion is reduced or while editing. */
function useReveal(root: React.RefObject<HTMLDivElement | null>, deps: readonly unknown[]): void {
  useEffect(() => {
    const element = root.current;
    const reduced = typeof matchMedia !== "function" || matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (element === null || typeof IntersectionObserver === "undefined" || reduced) {
      return;
    }
    element.classList.add("cs-js");
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-in");
            observer.unobserve(entry.target);
          }
        }
      },
      { rootMargin: "0px 0px -6% 0px", threshold: 0.06 },
    );
    for (const target of element.querySelectorAll("[data-reveal]")) {
      observer.observe(target);
    }
    return () => {
      observer.disconnect();
      element.classList.remove("cs-js");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the caller lists what should restart it
  }, deps);
}

function Body({ ctx }: { ctx: SiteContext }) {
  const { site, page } = ctx;
  const Hero = TEMPLATE_PARTS[templateKey(site.design.template)].Hero;
  const props: SectionProps = { ctx };
  const teaser: SectionProps = { ctx, teaser: true };
  if (site.design.layout === "one") {
    return (
      <>
        <Hero ctx={ctx} />
        <Services {...props} />
        <About {...props} />
        <Doctors {...props} />
        <Gallery {...props} />
        <Reviews {...props} />
        <Contact {...props} />
      </>
    );
  }
  switch (page) {
    case "about":
      return (
        <>
          <About {...props} />
          <Doctors {...props} />
          <Reviews {...teaser} />
        </>
      );
    case "services":
      return (
        <>
          <Services {...props} />
          <CallToAction {...props} />
        </>
      );
    case "gallery":
      return (
        <>
          <Gallery {...props} />
          <Reviews {...props} />
        </>
      );
    case "contact":
      return <Contact {...props} />;
    case "home":
      return (
        <>
          <Hero ctx={ctx} />
          <Services {...teaser} />
          <Doctors {...teaser} />
          <Reviews {...teaser} />
          <CallToAction {...props} />
        </>
      );
  }
}

/** A stored design id as a known one; anything else shows the first design. */
export function templateKey(id: string): TemplateId {
  return templateInfo(id).id;
}

/**
 * A clinic's website. The live site and the portal's preview both render this, so what the owner
 * edits is what patients see. Sizes follow the width of the element it sits in (container
 * queries), so a phone-width preview looks like a phone.
 */
export function ClinicSite({ site, page = "home", onNavigate, hrefFor, bookingUrl = null, edit, assetBase = "", className }: ClinicSiteProps) {
  const root = useRef<HTMLDivElement | null>(null);
  const template = templateKey(site.design.template);
  const palette = paletteOf(template, site.design.palette);
  const fonts = fontPairing(site.design.fonts);
  useFonts(fonts.id);
  const current: PageId = site.design.layout === "multi" ? page : "home";
  useReveal(root, [current, site, edit === undefined]);
  const ctx = useMemo<SiteContext>(
    () => ({
      site,
      page: current,
      editing: edit !== undefined,
      bookingUrl,
      hrefFor: hrefFor ?? (() => "#"),
      goto: (next) => {
        onNavigate?.(next);
      },
      assetBase,
    }),
    [site, current, edit, bookingUrl, hrefFor, onNavigate, assetBase],
  );
  const { Header, Footer } = TEMPLATE_PARTS[template];
  const style: CSSProperties & Record<`--${string}`, string> = {
    "--bg": palette.bg,
    "--surface": palette.surface,
    "--surface-2": palette.surface2,
    "--text": palette.text,
    "--muted": palette.muted,
    "--line": palette.line,
    "--accent": palette.accent,
    "--on-accent": palette.onAccent,
    "--accent-text": palette.accentText,
    "--font-head": fonts.heading,
    "--font-body": fonts.body,
  };
  const phone = site.clinic.phone;
  const inner: ReactNode = (
    <div ref={root} className={`cs-root cs-t-${template}${className === undefined ? "" : ` ${className}`}`} style={style} lang="en" data-palette={palette.id}>
      <a className="cs-skip" href="#main">
        Skip to content
      </a>
      <Header ctx={ctx} />
      <main id="main" className="cs-main">
        <div key={current} className="cs-page">
          <Body ctx={ctx} />
        </div>
      </main>
      <Footer ctx={ctx} />
      <div className="cs-dock">
        {phone != null && phone !== "" && (
          <a className="cs-btn cs-btn-ghost" href={telHref(phone)} aria-label={`Call ${prettyPhone(phone)}`}>
            <PhoneIcon />
            Call
          </a>
        )}
        <BookLink ctx={ctx}>Book</BookLink>
      </div>
    </div>
  );
  return edit === undefined ? inner : <EditProvider value={edit}>{inner}</EditProvider>;
}
