/** Pieces shared by every design: contact actions, hours, ratings, the booking embed. */

import { useState, type ReactNode } from "react";

import { CalendarIcon, FacebookIcon, InstagramIcon, MailIcon, PhoneIcon, PinIcon, StarIcon, WhatsAppIcon, YoutubeIcon } from "./icons.js";
import { directionsHref, hoursRows, initialsOf, prettyPhone, telHref, whatsappHref } from "./format.js";
import type { SitePage, SiteContext, SitePhoto } from "./types.js";

export function Stars({ rating }: { rating: number }) {
  return (
    <span className="cs-stars" role="img" aria-label={`${String(rating)} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <StarIcon key={n} filled={n <= rating} />
      ))}
    </span>
  );
}

/** The doctor's picture, or their initials in a circle. */
export function Portrait({ name, photo, assetBase }: { name: string; photo: SitePhoto | null | undefined; assetBase: string }) {
  if (photo != null) {
    return <img className="cs-portrait-img" src={`${assetBase}${photo.url}`} alt={photo.alt ?? name} loading="lazy" decoding="async" />;
  }
  return (
    <span className="cs-initials" aria-hidden="true">
      {initialsOf(name)}
    </span>
  );
}

export function HoursList({ site }: { site: SitePage }) {
  if (site.hours.length === 0) {
    return null;
  }
  return (
    <dl className="cs-hours">
      {hoursRows(site.hours).map((row) => (
        <div key={row.label} className={row.closed ? "is-closed" : undefined}>
          <dt>{row.label}</dt>
          <dd>{row.text}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Call, WhatsApp, email and directions as buttons or links, for the contact section. */
export function ContactActions({ site }: { site: SitePage }) {
  const { phone, whatsapp, email } = site.clinic;
  const directions = directionsHref(site);
  const text = `Hello ${site.clinic.name}, I would like to book an appointment.`;
  return (
    <ul className="cs-actions">
      {phone != null && phone !== "" && (
        <li>
          <a className="cs-link-btn" href={telHref(phone)}>
            <PhoneIcon />
            <span>Call {prettyPhone(phone)}</span>
          </a>
        </li>
      )}
      {whatsapp != null && whatsapp !== "" && (
        <li>
          <a className="cs-link-btn" href={whatsappHref(whatsapp, text)} target="_blank" rel="noopener noreferrer">
            <WhatsAppIcon />
            <span>WhatsApp us</span>
          </a>
        </li>
      )}
      {email != null && email !== "" && (
        <li>
          <a className="cs-link-btn" href={`mailto:${email}`}>
            <MailIcon />
            <span>{email}</span>
          </a>
        </li>
      )}
      {directions !== null && (
        <li>
          <a className="cs-link-btn" href={directions} target="_blank" rel="noopener noreferrer">
            <PinIcon />
            <span>Get directions</span>
          </a>
        </li>
      )}
    </ul>
  );
}

export function SocialLinks({ site }: { site: SitePage }) {
  const links: [string, string, ReactNode][] = [
    ["Instagram", site.social.instagram, <InstagramIcon key="i" />],
    ["Facebook", site.social.facebook, <FacebookIcon key="f" />],
    ["YouTube", site.social.youtube, <YoutubeIcon key="y" />],
  ];
  const shown = links.filter(([, href]) => href !== "");
  if (shown.length === 0) {
    return null;
  }
  return (
    <ul className="cs-social">
      {shown.map(([name, href, icon]) => (
        <li key={name}>
          <a href={href} target="_blank" rel="noopener noreferrer" aria-label={`${site.clinic.name} on ${name}`}>
            {icon}
          </a>
        </li>
      ))}
    </ul>
  );
}

/**
 * The booking flow inside the page. The booking page itself (`/book` on the clinic's portal host)
 * does the work; it loads only when the visitor asks, so the site stays light.
 */
export function BookingEmbed({ ctx, cta }: { ctx: SiteContext; cta: string }) {
  const [open, setOpen] = useState(false);
  const { site, bookingUrl } = ctx;
  if (!site.booking_enabled || bookingUrl === null) {
    return (
      <div className="cs-book cs-book-off">
        <h3>Book by phone</h3>
        <p>
          {site.clinic.phone != null && site.clinic.phone !== ""
            ? `Call ${prettyPhone(site.clinic.phone)} to book your visit.`
            : "Get in touch to book your visit."}
        </p>
        {ctx.editing && <p className="cs-hint">Online booking is switched off. Turn it on in Settings, Clinic profile.</p>}
      </div>
    );
  }
  return (
    <div className="cs-book">
      <div className="cs-book-head">
        <span className="cs-book-icon">
          <CalendarIcon />
        </span>
        <div>
          <h3>Book online</h3>
          <p>Choose a doctor and a time that suits you. We confirm by email.</p>
        </div>
      </div>
      {open ? (
        <>
          <iframe className="cs-book-frame" src={bookingUrl} title="Book an appointment" loading="lazy" />
          <a className="cs-book-new" href={bookingUrl} target="_blank" rel="noopener noreferrer">
            Open booking in a new tab
          </a>
        </>
      ) : (
        <button
          type="button"
          className="cs-btn cs-btn-primary"
          onClick={() => {
            setOpen(true);
          }}
        >
          {cta}
        </button>
      )}
    </div>
  );
}

/** A button-styled link that opens the booking section or page. */
export function BookLink({ ctx, children, className }: { ctx: SiteContext; children: ReactNode; className?: string }) {
  const { site } = ctx;
  const multi = site.design.layout === "multi";
  const href = multi ? ctx.hrefFor("contact") : "#book";
  return (
    <a
      className={className ?? "cs-btn cs-btn-primary"}
      href={href}
      onClick={(event) => {
        if (multi) {
          event.preventDefault();
          ctx.goto("contact");
        }
      }}
    >
      {children}
    </a>
  );
}
