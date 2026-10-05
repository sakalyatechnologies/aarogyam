/** Search and sharing basics: title, description, social tags and schema.org JSON-LD. */

import type { SitePage } from "@aarogyam/api-client";

import { addressLines, dayName } from "./format.js";
import type { PageId } from "./types.js";

export interface Seo {
  title: string;
  description: string;
  /** The schema.org description of the clinic, as a JSON-LD object. */
  jsonLd: Record<string, unknown>;
  /** Absolute or site-relative address of the picture to share. */
  image: string | null;
}

const PAGE_TITLES: Record<PageId, string> = {
  home: "",
  about: "About and doctors",
  services: "Services and fees",
  gallery: "Gallery",
  contact: "Contact and booking",
};

function trim(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`;
}

/** schema.org `Dentist`, from the public page data only. */
export function jsonLdFor(site: SitePage, origin: string): Record<string, unknown> {
  const { clinic } = site;
  const a = clinic.address;
  const hours = site.hours.flatMap((day) =>
    day.spans.map(([opens = "", closes = ""]) => ({
      "@type": "OpeningHoursSpecification",
      dayOfWeek: dayName(day.weekday),
      opens,
      closes,
    })),
  );
  const sameAs = [site.social.instagram, site.social.facebook, site.social.youtube].filter((l) => l !== "");
  const image = site.photos.hero ?? site.photos.about ?? site.photos.gallery[0];
  const data: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Dentist",
    name: clinic.name,
    medicalSpecialty: "Dentistry",
    url: origin,
  };
  if (clinic.phone != null && clinic.phone !== "") data["telephone"] = clinic.phone;
  if (clinic.email != null && clinic.email !== "") data["email"] = clinic.email;
  if (image !== undefined) data["image"] = `${origin}${image.url}`;
  if (site.photos.logo != null) data["logo"] = `${origin}${site.photos.logo.url}`;
  if (addressLines(a).length > 0) {
    data["address"] = {
      "@type": "PostalAddress",
      ...(a.line1 != null && a.line1 !== "" ? { streetAddress: [a.line1, a.line2].filter((p) => p != null && p !== "").join(", ") } : {}),
      ...(a.city != null && a.city !== "" ? { addressLocality: a.city } : {}),
      ...(a.state != null && a.state !== "" ? { addressRegion: a.state } : {}),
      ...(a.pincode != null && a.pincode !== "" ? { postalCode: a.pincode } : {}),
      addressCountry: "IN",
    };
  }
  if (hours.length > 0) data["openingHoursSpecification"] = hours;
  if (sameAs.length > 0) data["sameAs"] = sameAs;
  if (site.services.length > 0) {
    data["hasOfferCatalog"] = {
      "@type": "OfferCatalog",
      name: "Dental services",
      itemListElement: site.services.slice(0, 40).map((s) => ({ "@type": "Offer", itemOffered: { "@type": "MedicalProcedure", name: s.name } })),
    };
  }
  return data;
}

export function seoFor(site: SitePage, page: PageId, origin = ""): Seo {
  const name = site.clinic.name;
  const city = site.clinic.address.city ?? "";
  const own = site.seo.title.trim();
  const base = own !== "" ? own : `${name}${city === "" ? " | Dental clinic" : ` | Dental clinic in ${city}`}`;
  const pageTitle = site.design.layout === "multi" ? PAGE_TITLES[page] : "";
  const title = trim(pageTitle === "" ? base : `${pageTitle} | ${name}`, 70);
  const ownDescription = site.seo.description.trim();
  const description = trim(
    ownDescription !== ""
      ? ownDescription
      : `${name}${city === "" ? "" : ` in ${city}`}: dental care with clear treatment plans and fees, and easy online booking.`,
    160,
  );
  const image = site.photos.hero ?? site.photos.about ?? site.photos.gallery[0];
  return { title, description, jsonLd: jsonLdFor(site, origin), image: image === undefined ? null : `${origin}${image.url}` };
}

function setMeta(doc: Document, attr: "name" | "property", key: string, value: string): void {
  let element = doc.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  if (element === null) {
    element = doc.createElement("meta");
    element.setAttribute(attr, key);
    doc.head.append(element);
  }
  element.setAttribute("content", value);
}

/** Writes the tags into the document's head. Call again on every page change. */
export function applySeo(doc: Document, seo: Seo, themeColor?: string): void {
  doc.title = seo.title;
  setMeta(doc, "name", "description", seo.description);
  setMeta(doc, "property", "og:title", seo.title);
  setMeta(doc, "property", "og:description", seo.description);
  setMeta(doc, "property", "og:type", "website");
  if (seo.image !== null) {
    setMeta(doc, "property", "og:image", seo.image);
  }
  if (themeColor !== undefined) {
    setMeta(doc, "name", "theme-color", themeColor);
  }
  let script = doc.head.querySelector<HTMLScriptElement>("script#cs-jsonld");
  if (script === null) {
    script = doc.createElement("script");
    script.id = "cs-jsonld";
    script.type = "application/ld+json";
    doc.head.append(script);
  }
  // `<` is escaped so a clinic name can never close the script element.
  script.textContent = JSON.stringify(seo.jsonLd).replaceAll("<", "\\u003c");
}
