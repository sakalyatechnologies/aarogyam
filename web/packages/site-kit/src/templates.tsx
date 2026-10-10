/**
 * What differs between the four designs besides CSS: the header, the opening of the home page
 * and the footer. Sections below the opening share their markup (`sections.tsx`).
 */

import type { ReactNode } from "react";

import { resolveCopy } from "./copy.js";
import { PhotoSlot, Txt } from "./edit.js";
import { addressLines, hoursRows, openDays, prettyPhone, telHref } from "./format.js";
import { ArrowIcon, CheckIcon, ClockIcon, PhoneIcon, ToothIcon } from "./icons.js";
import { Brand, NavLinks } from "./nav.js";
import { BookLink, SocialLinks } from "./parts.js";
import type { SiteContext } from "./types.js";
import type { TemplateId } from "./catalog.js";

export interface TemplateParts {
  Header: (props: { ctx: SiteContext }) => ReactNode;
  Hero: (props: { ctx: SiteContext }) => ReactNode;
  Footer: (props: { ctx: SiteContext }) => ReactNode;
}

function HeroText({ ctx, headingClass }: { ctx: SiteContext; headingClass?: string }) {
  const { site } = ctx;
  const copy = resolveCopy(site);
  return (
    <>
      <Txt as="h1" path="hero.headline" value={site.hero.headline} fallback={copy.headline} label="Headline" className={headingClass ?? "cs-h1"} />
      <Txt as="p" path="hero.subheadline" value={site.hero.subheadline} fallback={copy.subheadline} label="Subheading" className="cs-lead" />
    </>
  );
}

function HeroActions({ ctx }: { ctx: SiteContext }) {
  const { site } = ctx;
  const copy = resolveCopy(site);
  const phone = site.clinic.phone;
  return (
    <div className="cs-hero-actions">
      <BookLink ctx={ctx}>
        {copy.cta}
        <ArrowIcon />
      </BookLink>
      {phone != null && phone !== "" && (
        <a className="cs-btn cs-btn-ghost" href={telHref(phone)}>
          <PhoneIcon />
          {prettyPhone(phone)}
        </a>
      )}
    </div>
  );
}

function Facts({ ctx }: { ctx: SiteContext }) {
  const { site } = ctx;
  const days = openDays(site.hours);
  const facts: [string, string][] = [];
  if (site.doctors.length > 0) facts.push([String(site.doctors.length), site.doctors.length === 1 ? "Dentist" : "Specialists"]);
  if (site.services.length > 0) facts.push([String(site.services.length), "Treatments"]);
  if (days > 0) facts.push([String(days), days === 1 ? "Day a week" : "Days a week"]);
  if (site.booking_enabled) facts.push(["24/7", "Online booking"]);
  return (
    <ul className="cs-facts" data-reveal>
      {facts.map(([n, label]) => (
        <li key={label}>
          <strong>{n}</strong>
          <span>{label}</span>
        </li>
      ))}
    </ul>
  );
}

const Art = ({ id }: { id: string }) => (
  <div className={`cs-art cs-art-${id}`} aria-hidden="true">
    <ToothIcon size={96} />
  </div>
);

function Dock({ ctx }: { ctx: SiteContext }) {
  const phone = ctx.site.clinic.phone;
  return (
    <div className="cs-footer-inner">
      <Brand ctx={ctx} />
      <address>
        {addressLines(ctx.site.clinic.address).map((l) => (
          <span key={l}>{l}</span>
        ))}
        {phone != null && phone !== "" && <a href={telHref(phone)}>{prettyPhone(phone)}</a>}
      </address>
      <SocialLinks site={ctx.site} />
    </div>
  );
}

const year = (): number => new Date().getFullYear();

// ------------------------------------------------------------------------------------------ aurora

const aurora: TemplateParts = {
  Header: ({ ctx }) => (
    <header className="cs-header" id="top">
      <div className="cs-wrap cs-header-row">
        <Brand ctx={ctx} />
        <NavLinks ctx={ctx} />
        <BookLink ctx={ctx} className="cs-btn cs-btn-primary cs-btn-sm">
          Book
        </BookLink>
      </div>
    </header>
  ),
  Hero: ({ ctx }) => (
    <section className="cs-hero" aria-label="Welcome">
      <div className="cs-glow" aria-hidden="true" />
      <div className="cs-wrap cs-hero-grid">
        <div className="cs-hero-copy">
          <p className="cs-eyebrow cs-fade">{ctx.site.clinic.address.city ?? "Dental care"}</p>
          <HeroText ctx={ctx} />
          <HeroActions ctx={ctx} />
        </div>
        <PhotoSlot kind="hero" photo={ctx.site.photos.hero} assetBase={ctx.assetBase} className="cs-hero-photo" eager label="top picture" fallback={<Art id="aurora" />} />
      </div>
      <div className="cs-wrap">
        <Facts ctx={ctx} />
      </div>
    </section>
  ),
  Footer: ({ ctx }) => (
    <footer className="cs-footer">
      <div className="cs-wrap">
        <Dock ctx={ctx} />
        <p className="cs-legal">© {year()} {ctx.site.clinic.name}</p>
      </div>
    </footer>
  ),
};

// ------------------------------------------------------------------------------------------ hearth

const hearth: TemplateParts = {
  Header: ({ ctx }) => (
    <header className="cs-header" id="top">
      <div className="cs-wrap cs-header-row">
        <Brand ctx={ctx} />
        <NavLinks ctx={ctx} />
        <BookLink ctx={ctx} className="cs-btn cs-btn-primary cs-btn-sm">
          Book a visit
        </BookLink>
      </div>
    </header>
  ),
  Hero: ({ ctx }) => {
    const copy = resolveCopy(ctx.site);
    return (
      <section className="cs-hero" aria-label="Welcome">
        <span className="cs-blob cs-blob-a" aria-hidden="true" />
        <span className="cs-blob cs-blob-b" aria-hidden="true" />
        <div className="cs-wrap cs-hero-grid">
          <div className="cs-hero-copy">
            <HeroText ctx={ctx} />
            <ul className="cs-chips">
              {copy.highlights.slice(0, 3).map((h) => (
                <li key={h}>
                  <CheckIcon />
                  {h}
                </li>
              ))}
            </ul>
            <HeroActions ctx={ctx} />
          </div>
          <PhotoSlot kind="hero" photo={ctx.site.photos.hero} assetBase={ctx.assetBase} className="cs-hero-photo" eager label="top picture" fallback={<Art id="hearth" />} />
        </div>
      </section>
    );
  },
  Footer: ({ ctx }) => (
    <footer className="cs-footer">
      <svg className="cs-wave" viewBox="0 0 1440 60" preserveAspectRatio="none" aria-hidden="true" focusable="false">
        <path d="M0 30c240 40 480 40 720 10s480-30 720 5v15H0z" fill="currentColor" />
      </svg>
      <div className="cs-wrap">
        <Dock ctx={ctx} />
        <p className="cs-legal">© {year()} {ctx.site.clinic.name}. Made with care.</p>
      </div>
    </footer>
  ),
};

// ---------------------------------------------------------------------------------------- clinical

const clinical: TemplateParts = {
  Header: ({ ctx }) => {
    const phone = ctx.site.clinic.phone;
    const first = hoursRows(ctx.site.hours).find((r) => !r.closed);
    return (
      <header className="cs-header" id="top">
        {(phone != null && phone !== "") || first !== undefined ? (
          <div className="cs-topbar">
            <div className="cs-wrap">
              {first !== undefined && (
                <span>
                  <ClockIcon /> {first.label}: {first.text}
                </span>
              )}
              {phone != null && phone !== "" && (
                <a href={telHref(phone)}>
                  <PhoneIcon /> {prettyPhone(phone)}
                </a>
              )}
            </div>
          </div>
        ) : null}
        <div className="cs-wrap cs-header-row">
          <Brand ctx={ctx} />
          <NavLinks ctx={ctx} />
          <BookLink ctx={ctx} className="cs-btn cs-btn-primary cs-btn-sm">
            Book online
          </BookLink>
        </div>
      </header>
    );
  },
  Hero: ({ ctx }) => {
    const { site } = ctx;
    const phone = site.clinic.phone;
    return (
      <section className="cs-hero" aria-label="Welcome">
        <div className="cs-wrap cs-hero-grid">
          <div className="cs-hero-copy">
            <p className="cs-eyebrow cs-fade">{site.clinic.name}</p>
            <HeroText ctx={ctx} />
            <HeroActions ctx={ctx} />
          </div>
          <aside className="cs-panel" aria-label="Book your visit" data-reveal>
            <h2>Book your visit</h2>
            <ol>
              <li>Pick a doctor and a time</li>
              <li>Confirm with your email</li>
              <li>We see you at the clinic</li>
            </ol>
            <BookLink ctx={ctx}>
              {site.booking_enabled ? "Choose a time" : "How to book"}
              <ArrowIcon />
            </BookLink>
            {phone != null && phone !== "" && <p className="cs-panel-note">Or call {prettyPhone(phone)}</p>}
          </aside>
        </div>
        {site.photos.hero != null || ctx.editing ? (
          <div className="cs-wrap">
            <PhotoSlot kind="hero" photo={site.photos.hero} assetBase={ctx.assetBase} className="cs-hero-photo" eager label="top picture" />
          </div>
        ) : null}
        <div className="cs-wrap">
          <Facts ctx={ctx} />
        </div>
      </section>
    );
  },
  Footer: ({ ctx }) => (
    <footer className="cs-footer">
      <div className="cs-wrap">
        <Dock ctx={ctx} />
        <p className="cs-legal">© {year()} {ctx.site.clinic.name}</p>
      </div>
    </footer>
  ),
};

// ------------------------------------------------------------------------------------------- bold

const bold: TemplateParts = {
  Header: ({ ctx }) => (
    <header className="cs-header" id="top">
      <div className="cs-wrap cs-header-row">
        <Brand ctx={ctx} />
        <NavLinks ctx={ctx} />
        <BookLink ctx={ctx} className="cs-btn cs-btn-primary cs-btn-sm">
          Book now
        </BookLink>
      </div>
    </header>
  ),
  Hero: ({ ctx }) => {
    const { site } = ctx;
    const names = site.services.slice(0, 8).map((s) => s.name);
    return (
      <section className="cs-hero" aria-label="Welcome">
        <div className="cs-wrap cs-hero-grid">
          <div className="cs-hero-copy">
            <HeroText ctx={ctx} headingClass="cs-h1 cs-mega" />
            <HeroActions ctx={ctx} />
          </div>
          <PhotoSlot kind="hero" photo={site.photos.hero} assetBase={ctx.assetBase} className="cs-hero-photo" eager label="top picture" fallback={<Art id="bold" />} />
        </div>
        {names.length > 0 && (
          <div className="cs-marquee" aria-hidden="true">
            <div className="cs-marquee-track">
              {[0, 1].map((copy) => (
                <span key={copy}>
                  {names.map((n) => (
                    <b key={`${String(copy)}-${n}`}>{n}</b>
                  ))}
                </span>
              ))}
            </div>
          </div>
        )}
      </section>
    );
  },
  Footer: ({ ctx }) => (
    <footer className="cs-footer">
      <div className="cs-wrap">
        <p className="cs-footer-big">{ctx.site.clinic.name}</p>
        <Dock ctx={ctx} />
        <p className="cs-legal">© {year()} {ctx.site.clinic.name}</p>
      </div>
    </footer>
  ),
};

// ---------------------------------------------------------------------------------------- heritage

const heritage: TemplateParts = {
  Header: ({ ctx }) => (
    <header className="cs-header" id="top">
      <div className="cs-wrap cs-header-stack">
        <Brand ctx={ctx} />
        <div className="cs-header-nav">
          <NavLinks ctx={ctx} />
          <BookLink ctx={ctx} className="cs-btn cs-btn-primary cs-btn-sm">
            Book a visit
          </BookLink>
        </div>
      </div>
    </header>
  ),
  Hero: ({ ctx }) => {
    const { site } = ctx;
    return (
      <section className="cs-hero" aria-label="Welcome">
        <div className="cs-wrap cs-hero-center">
          <div className="cs-hero-copy">
            <p className="cs-motto" lang="sa" aria-hidden="true">
              आरोग्यं धनसम्पदा
            </p>
            <span className="cs-rule" aria-hidden="true" />
            <HeroText ctx={ctx} />
            <HeroActions ctx={ctx} />
          </div>
          {site.photos.hero != null || ctx.editing ? (
            <PhotoSlot kind="hero" photo={site.photos.hero} assetBase={ctx.assetBase} className="cs-hero-photo" eager label="top picture" fallback={<Art id="heritage" />} />
          ) : null}
          <Facts ctx={ctx} />
        </div>
      </section>
    );
  },
  Footer: ({ ctx }) => (
    <footer className="cs-footer">
      <div className="cs-wrap">
        <span className="cs-rule" aria-hidden="true" />
        <Dock ctx={ctx} />
        <p className="cs-legal">© {year()} {ctx.site.clinic.name}</p>
      </div>
    </footer>
  ),
};

// ------------------------------------------------------------------------------------- smilebright

const smilebright: TemplateParts = {
  Header: ({ ctx }) => (
    <header className="cs-header" id="top">
      <div className="cs-wrap cs-header-row">
        <Brand ctx={ctx} />
        <NavLinks ctx={ctx} />
        <BookLink ctx={ctx} className="cs-btn cs-btn-primary cs-btn-sm">
          Book a visit
        </BookLink>
      </div>
    </header>
  ),
  Hero: ({ ctx }) => {
    const copy = resolveCopy(ctx.site);
    return (
      <section className="cs-hero" aria-label="Welcome">
        <span className="cs-bubble cs-bubble-a" aria-hidden="true" />
        <span className="cs-bubble cs-bubble-b" aria-hidden="true" />
        <div className="cs-wrap cs-hero-grid">
          <div className="cs-hero-copy">
            <p className="cs-pill">
              <ToothIcon size={18} />
              Happy smiles start here
            </p>
            <HeroText ctx={ctx} />
            <ul className="cs-chips">
              {copy.highlights.slice(0, 3).map((h) => (
                <li key={h}>
                  <CheckIcon />
                  {h}
                </li>
              ))}
            </ul>
            <HeroActions ctx={ctx} />
          </div>
          <div className="cs-play-art">
            <PhotoSlot kind="hero" photo={ctx.site.photos.hero} assetBase={ctx.assetBase} className="cs-hero-photo" eager label="top picture" fallback={<Art id="smilebright" />} />
            <span className="cs-sticker" aria-hidden="true">
              <ToothIcon size={26} />
            </span>
          </div>
        </div>
        <div className="cs-wrap">
          <Facts ctx={ctx} />
        </div>
      </section>
    );
  },
  Footer: ({ ctx }) => (
    <footer className="cs-footer">
      <div className="cs-wrap">
        <Dock ctx={ctx} />
        <p className="cs-legal">© {year()} {ctx.site.clinic.name}. Keep smiling.</p>
      </div>
    </footer>
  ),
};

// ---------------------------------------------------------------------------------------- bento
// The three bento designs share this markup and differ in palette (and a few CSS details).

const bento: TemplateParts = {
  Header: ({ ctx }) => (
    <header className="cs-header" id="top">
      <div className="cs-wrap">
        <div className="cs-header-row cs-bar">
          <Brand ctx={ctx} />
          <NavLinks ctx={ctx} />
          <BookLink ctx={ctx} className="cs-btn cs-btn-primary cs-btn-sm">
            Book now
          </BookLink>
        </div>
      </div>
    </header>
  ),
  Hero: ({ ctx }) => {
    const { site } = ctx;
    const copy = resolveCopy(site);
    const first = hoursRows(site.hours).find((r) => !r.closed);
    const [h0, h1, h2] = copy.highlights;
    return (
      <section className="cs-hero" aria-label="Welcome">
        <div className="cs-wrap">
          <div className="cs-bento">
            <div className="cs-bento-title">
              <HeroText ctx={ctx} headingClass="cs-h1 cs-mega" />
              <HeroActions ctx={ctx} />
            </div>
            <PhotoSlot kind="hero" photo={site.photos.hero} assetBase={ctx.assetBase} className="cs-hero-photo cs-tile cs-tile-photo" eager label="top picture" fallback={<Art id="bento" />} />
            {h0 !== undefined && (
              <div className="cs-tile cs-tile-a" data-reveal>
                <CheckIcon />
                <p>{h0}</p>
              </div>
            )}
            {h1 !== undefined && (
              <div className="cs-tile cs-tile-b" data-reveal>
                <CheckIcon />
                <p>{h1}</p>
              </div>
            )}
            {h2 !== undefined && (
              <div className="cs-tile cs-tile-b" data-reveal>
                <CheckIcon />
                <p>{h2}</p>
              </div>
            )}
            {first !== undefined && (
              <div className="cs-tile cs-tile-a" data-reveal>
                <ClockIcon />
                <p>
                  <b>{first.label}</b>
                  <span>{first.text}</span>
                </p>
              </div>
            )}
            <div className="cs-tile cs-tile-dark" data-reveal>
              <p>{site.booking_enabled ? "Online booking, any hour" : "Call to book a visit"}</p>
              <BookLink ctx={ctx}>
                {site.booking_enabled ? "Choose a time" : "How to book"}
                <ArrowIcon />
              </BookLink>
            </div>
          </div>
        </div>
      </section>
    );
  },
  Footer: ({ ctx }) => (
    <footer className="cs-footer">
      <div className="cs-wrap cs-footer-tile">
        <p className="cs-footer-big">{ctx.site.clinic.name}</p>
        <Dock ctx={ctx} />
        <p className="cs-legal">© {year()} {ctx.site.clinic.name}</p>
      </div>
    </footer>
  ),
};

export const TEMPLATE_PARTS: Record<TemplateId, TemplateParts> = {
  aurora,
  hearth,
  clinical,
  bold,
  heritage,
  smilebright,
  bentopeach: bento,
  bentopistachio: bento,
  bentomidnight: bento,
};
