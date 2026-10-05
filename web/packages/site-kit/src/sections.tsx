/**
 * The content sections. Every design draws the same sections from the same markup and gives them
 * its own look in CSS, so a clinic can switch design without losing anything it wrote.
 */

import type { ReactNode } from "react";

import { PhotoSlot, Txt, useEdit } from "./edit.js";
import { categoryLabel, formatFee, addressLines } from "./format.js";
import { resolveCopy } from "./copy.js";
import { ArrowIcon, CheckIcon, ClockIcon, PinIcon } from "./icons.js";
import { BookingEmbed, BookLink, ContactActions, HoursList, Portrait, SocialLinks, Stars } from "./parts.js";
import type { PageId, SectionProps, SitePage } from "./types.js";

export function SectionHead({ id, eyebrow, title, intro }: { id?: string | undefined; eyebrow: string; title: ReactNode; intro?: ReactNode }) {
  return (
    <div className="cs-head" data-reveal>
      <p className="cs-eyebrow">{eyebrow}</p>
      <h2 id={id}>{title}</h2>
      {intro !== undefined && <div className="cs-intro">{intro}</div>}
    </div>
  );
}

function PageLink({ ctx, page, children }: { ctx: SectionProps["ctx"]; page: PageId; children: ReactNode }) {
  if (ctx.site.design.layout !== "multi") {
    return null;
  }
  return (
    <a
      className="cs-more"
      href={ctx.hrefFor(page)}
      onClick={(event) => {
        event.preventDefault();
        ctx.goto(page);
      }}
    >
      {children}
      <ArrowIcon />
    </a>
  );
}

/** Services grouped by category, with fees from the price list. */
export function Services({ ctx, teaser }: SectionProps) {
  const { site } = ctx;
  const copy = resolveCopy(site);
  const list = teaser === true ? site.services.slice(0, 6) : site.services;
  const groups: { label: string; items: SitePage["services"] }[] = [];
  for (const service of list) {
    const label = categoryLabel(service.category);
    const group = groups.find((g) => g.label === label);
    if (group === undefined) {
      groups.push({ label, items: [service] });
    } else {
      group.items.push(service);
    }
  }
  return (
    <section className="cs-section cs-services" id="services" aria-labelledby="services-title">
      <div className="cs-wrap">
        <SectionHead
          id="services-title"
          eyebrow="Treatments"
          title="Our services"
          intro={<Txt path="services.intro" value={site.services_intro ?? ""} fallback={copy.servicesIntro} label="Services introduction" as="p" />}
        />
        {site.services.length === 0 ? (
          <p className="cs-empty">Our price list is being updated. Please call us for fees.</p>
        ) : teaser === true ? (
          <ul className="cs-service-grid">
            {list.map((s, i) => (
              <ServiceCard key={s.id} service={s} index={i} />
            ))}
          </ul>
        ) : (
          groups.map((group) => (
            <div key={group.label} className="cs-group" data-reveal>
              <h3>{group.label}</h3>
              <ul className="cs-service-grid">
                {group.items.map((s, i) => (
                  <ServiceCard key={s.id} service={s} index={i} />
                ))}
              </ul>
            </div>
          ))
        )}
        {teaser === true && site.services.length > list.length && (
          <div className="cs-more-row">
            <PageLink ctx={ctx} page="services">
              See all {site.services.length} services
            </PageLink>
          </div>
        )}
      </div>
    </section>
  );
}

function ServiceCard({ service, index }: { service: SitePage["services"][number]; index: number }) {
  return (
    <li className="cs-service" data-reveal>
      <span className="cs-n" aria-hidden="true">
        {String(index + 1).padStart(2, "0")}
      </span>
      <div className="cs-service-text">
        <h4>{service.name}</h4>
        {service.description != null && service.description !== "" && <p>{service.description}</p>}
      </div>
      {service.fee_paise != null && <span className="cs-fee">{formatFee(service.fee_paise)}</span>}
    </li>
  );
}

export function About({ ctx }: SectionProps) {
  const { site, assetBase } = ctx;
  const copy = resolveCopy(site);
  return (
    <section className="cs-section cs-about" id="about" aria-labelledby="about-title">
      <div className="cs-wrap cs-about-grid">
        <div className="cs-about-text">
          <SectionHead
            id="about-title"
            eyebrow="About us"
            title={<Txt path="about.title" value={site.about.title} fallback={copy.aboutTitle} label="About title" />}
          />
          <div data-reveal>
            <Txt path="about.body" value={site.about.body} fallback={copy.aboutBody} multiline label="About text" className="cs-prose" />
          </div>
          <ul className="cs-points" data-reveal>
            {copy.highlights.map((h, i) => (
              <li key={`${String(i)}-${h}`}>
                <CheckIcon />
                <Txt path={`about.highlights.${String(i)}`} value={copy.isDefault.highlights ? "" : h} fallback={h} label={`Point ${String(i + 1)}`} />
              </li>
            ))}
          </ul>
        </div>
        <PhotoSlot kind="about" photo={site.photos.about} assetBase={assetBase} className="cs-about-photo" label="about picture" fallback={<div className="cs-art" aria-hidden="true" />} />
      </div>
    </section>
  );
}

export function Doctors({ ctx, teaser }: SectionProps) {
  const { site, assetBase } = ctx;
  const list = teaser === true ? site.doctors.slice(0, 3) : site.doctors;
  if (list.length === 0) {
    return null;
  }
  return (
    <section className="cs-section cs-doctors" id="doctors" aria-labelledby="doctors-title">
      <div className="cs-wrap">
        <SectionHead id="doctors-title" eyebrow="Our team" title={site.doctors.length === 1 ? "Meet your dentist" : "Meet our doctors"} />
        <ul className="cs-doctor-grid">
          {list.map((d) => (
            <li key={d.id} className="cs-doctor" data-reveal>
              <div className="cs-portrait">
                <Portrait name={d.name} photo={d.photo} assetBase={assetBase} />
              </div>
              <div className="cs-doctor-text">
                <h3>{d.name}</h3>
                {d.specialty != null && d.specialty !== "" && <p className="cs-role">{d.specialty}</p>}
                {(d.qualifications != null && d.qualifications !== "") || ctx.editing ? (
                  <Txt path={`doctors.${d.id}.qualifications`} value={d.qualifications ?? ""} fallback="Add qualifications" label={`Qualifications of ${d.name}`} as="p" className="cs-quals" />
                ) : null}
                {(d.bio != null && d.bio !== "") || ctx.editing ? (
                  <Txt path={`doctors.${d.id}.bio`} value={d.bio ?? ""} fallback="Add a short introduction" label={`Introduction of ${d.name}`} as="p" className="cs-bio" />
                ) : null}
              </div>
            </li>
          ))}
        </ul>
        {teaser === true && site.doctors.length > list.length && (
          <div className="cs-more-row">
            <PageLink ctx={ctx} page="about">
              Meet the whole team
            </PageLink>
          </div>
        )}
      </div>
    </section>
  );
}

export function Gallery({ ctx }: SectionProps) {
  const { site, assetBase } = ctx;
  const edit = useEdit();
  const photos = site.photos.gallery;
  if (photos.length === 0 && edit === null) {
    return null;
  }
  return (
    <section className="cs-section cs-gallery" id="gallery" aria-labelledby="gallery-title">
      <div className="cs-wrap">
        <SectionHead id="gallery-title" eyebrow="Inside the clinic" title="A look around" />
        <ul className="cs-gallery-grid">
          {photos.map((p, i) => (
            <li key={p.id} data-reveal className={`cs-g${String(i % 6)}`}>
              <img src={`${assetBase}${p.url}`} alt={p.alt ?? ""} loading="lazy" decoding="async" />
            </li>
          ))}
          {edit !== null && (
            <li className="cs-gallery-add">
              <button
                type="button"
                className="cs-slot-btn is-static"
                onClick={() => {
                  edit.pickPhoto("gallery", null);
                }}
              >
                Add a gallery picture
              </button>
            </li>
          )}
        </ul>
      </div>
    </section>
  );
}

export function Reviews({ ctx, teaser }: SectionProps) {
  const { site } = ctx;
  const edit = useEdit();
  const list = teaser === true ? site.reviews.slice(0, 3) : site.reviews;
  if (list.length === 0 && edit === null) {
    return null;
  }
  return (
    <section className="cs-section cs-reviews" id="reviews" aria-labelledby="reviews-title">
      <div className="cs-wrap">
        <SectionHead id="reviews-title" eyebrow="Kind words" title="What patients say" />
        {list.length === 0 ? (
          <p className="cs-hint">Add reviews your patients have given you in the Content panel.</p>
        ) : (
          <ul className="cs-review-grid">
            {list.map((r, i) => (
              <li key={`${String(i)}-${r.name}`} className="cs-review" data-reveal>
                <Stars rating={r.rating} />
                <blockquote>
                  <Txt path={`reviews.${String(i)}.text`} value={r.text} fallback={r.text} multiline label={`Review by ${r.name}`} />
                </blockquote>
                <p className="cs-reviewer">
                  <Txt path={`reviews.${String(i)}.name`} value={r.name} fallback={r.name} label={`Name on review ${String(i + 1)}`} />
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

/** Address, hours, ways to reach the clinic, and the booking flow. */
export function Contact({ ctx }: SectionProps) {
  const { site } = ctx;
  const copy = resolveCopy(site);
  const lines = addressLines(site.clinic.address);
  return (
    <section className="cs-section cs-contact" id="contact" aria-labelledby="contact-title">
      <div className="cs-wrap">
        <SectionHead id="contact-title" eyebrow="Visit us" title="Contact and booking" />
        <div className="cs-contact-grid">
          <div className="cs-contact-info" data-reveal>
            {lines.length > 0 && (
              <div className="cs-block">
                <h3>
                  <PinIcon /> Find us
                </h3>
                <address>
                  <strong>{site.clinic.name}</strong>
                  {lines.map((l) => (
                    <span key={l}>{l}</span>
                  ))}
                </address>
              </div>
            )}
            {site.hours.length > 0 && (
              <div className="cs-block">
                <h3>
                  <ClockIcon /> Opening hours
                </h3>
                <HoursList site={site} />
                <Txt path="hours_note" value={site.hours_note ?? ""} fallback={ctx.editing ? "Add a note, such as Closed on public holidays" : copy.hoursNote} as="p" className="cs-note" label="Opening hours note" />
              </div>
            )}
            <ContactActions site={site} />
            <SocialLinks site={site} />
          </div>
          <div id="book" className="cs-contact-book" data-reveal>
            <BookingEmbed ctx={ctx} cta="Start booking" />
          </div>
        </div>
      </div>
    </section>
  );
}

/** A closing call to book, for the end of a page. */
export function CallToAction({ ctx }: SectionProps) {
  const { site } = ctx;
  return (
    <section className="cs-section cs-cta" aria-label="Book an appointment">
      <div className="cs-wrap cs-cta-box" data-reveal>
        <h2>Ready when you are</h2>
        <p>Book a visit with {site.clinic.name} in a minute. Pick a time that suits you.</p>
        <BookLink ctx={ctx}>Book an appointment</BookLink>
      </div>
    </section>
  );
}
