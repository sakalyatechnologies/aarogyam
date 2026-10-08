/** The fake of the clinic website API: settings, pictures and the public page, with the real API's checks. */

import type * as C from "../contract.js";
import type { FakeClinic, Fixtures } from "./fixtures.js";

/** The designs and their palettes, as the API's catalogue lists them. */
export const SITE_TEMPLATES: C.SiteTemplate[] = [
  { id: "aurora", palettes: ["gold", "emerald", "sapphire", "amethyst"] },
  { id: "hearth", palettes: ["terracotta", "sage", "honey", "berry"] },
  { id: "clinical", palettes: ["sky", "mint", "slate", "indigo"] },
  { id: "bold", palettes: ["electric", "coral", "lime", "violet"] },
];
export const SITE_FONTS = ["modern", "elegant", "friendly", "editorial"];

const GOODS = ["medicine", "medicines", "product", "products"];

export interface FakeSite {
  clinic_id: string;
  layout: "one" | "multi";
  template: string;
  palette: string;
  fonts: string;
  content: C.WebsiteContent;
  published: boolean;
  published_at: string | null;
  custom_domain: string | null;
  domain_status: "none" | "pending" | "verified" | "failed";
  domain_token: string | null;
}

export interface FakePhoto {
  id: string;
  clinic_id: string;
  kind: "logo" | "hero" | "about" | "doctor" | "gallery";
  alt: string | null;
  url: string;
}

type Store = Fixtures & { websites?: FakeSite[]; websitePhotos?: FakePhoto[] };

export function emptyContent(): C.WebsiteContent {
  return {
    hero: { headline: "", subheadline: "", cta_label: "" },
    about: { title: "", body: "", highlights: [] },
    doctors: [],
    services: { intro: "", show_fees: true, hidden: [], notes: [] },
    reviews: [],
    contact: { whatsapp: "", email: "", map_url: "", hours_note: "" },
    social: { instagram: "", facebook: "", youtube: "" },
    seo: { title: "", description: "" },
  };
}

export function siteOf(state: Store, clinicId: string): FakeSite {
  state.websites ??= [];
  let site = state.websites.find((s) => s.clinic_id === clinicId);
  if (site === undefined) {
    site = {
      clinic_id: clinicId,
      layout: "one",
      template: "aurora",
      palette: "gold",
      fonts: "modern",
      content: emptyContent(),
      published: false,
      published_at: null,
      custom_domain: null,
      domain_status: "none",
      domain_token: null,
    };
    state.websites.push(site);
  }
  return site;
}

export function photosOf(state: Store, clinicId: string): FakePhoto[] {
  state.websitePhotos ??= [];
  return state.websitePhotos.filter((p) => p.clinic_id === clinicId);
}

export const isPhotoKind = (kind: string): kind is FakePhoto["kind"] => ["logo", "hero", "about", "doctor", "gallery"].includes(kind);

export const wirePhoto = (p: FakePhoto): C.SitePhoto => ({ id: p.id, kind: p.kind, url: p.url, alt: p.alt });

function address(clinic: FakeClinic): C.SiteAddress {
  const a = clinic.address ?? {};
  return { line1: a.line1 ?? null, line2: a.line2 ?? null, city: a.city ?? null, state: a.state ?? null, pincode: a.pincode ?? null };
}

function openingHours(state: Store, clinicId: string): C.SiteDay[] {
  const active = new Set(state.practitioners.filter((p) => p.clinic_id === clinicId && p.active).map((p) => p.id));
  const days = new Map<number, [string, string][]>();
  for (const shift of state.workingShifts) {
    if (shift.clinic_id === clinicId && active.has(shift.practitioner_id)) {
      days.set(shift.weekday, [...(days.get(shift.weekday) ?? []), [shift.starts.slice(0, 5), shift.ends.slice(0, 5)]]);
    }
  }
  return [...days.entries()]
    .sort(([a], [b]) => a - b)
    .map(([weekday, spans]) => {
      const merged: [string, string][] = [];
      for (const span of spans.sort()) {
        const last = merged[merged.length - 1];
        if (last !== undefined && span[0] <= last[1]) {
          last[1] = span[1] > last[1] ? span[1] : last[1];
        } else {
          merged.push([...span]);
        }
      }
      return { weekday, spans: merged };
    });
}

const some = (text: string): string | null => (text === "" ? null : text);

/** The page as the public would see it, built from the clinic's records and the owner's content. */
export function buildPage(state: Store, clinic: FakeClinic, site: FakeSite, bookingEnabled: boolean): C.SitePage {
  const photos = photosOf(state, clinic.id).map(wirePhoto);
  const one = (kind: string) => photos.find((p) => p.kind === kind) ?? null;
  const content = site.content;
  const doctors = state.practitioners
    .filter((p) => p.clinic_id === clinic.id && p.active)
    .flatMap((p): C.SiteDoctor[] => {
      const profile = content.doctors.find((d) => d.practitioner_id === p.id);
      if (profile?.hidden === true) {
        return [];
      }
      return [
        {
          id: p.id,
          name: p.display_name,
          specialty: p.specialty ?? null,
          qualifications: some(profile?.qualifications ?? ""),
          bio: some(profile?.bio ?? ""),
          photo: photos.find((ph) => ph.id === profile?.photo_id) ?? null,
        },
      ];
    });
  const services = state.priceItems
    .filter((i) => i.clinic_id === clinic.id && i.active && !GOODS.includes(i.category ?? ""))
    .filter((i) => !content.services.hidden.includes(i.id))
    .map(
      (i): C.SiteService => ({
        id: i.id,
        name: i.name,
        category: i.category ?? null,
        fee_paise: content.services.show_fees ? i.price_paise : null,
        description: some(content.services.notes.find((n) => n.price_item_id === i.id)?.description ?? ""),
      }),
    );
  return {
    design: { layout: site.layout, template: site.template, palette: site.palette, fonts: site.fonts },
    clinic: {
      name: clinic.name,
      brand: clinic.branding.brand,
      address: address(clinic),
      phone: clinic.phone ?? null,
      whatsapp: some(content.contact.whatsapp),
      email: some(content.contact.email),
      map_url: some(content.contact.map_url),
    },
    hours: openingHours(state, clinic.id),
    hours_note: some(content.contact.hours_note),
    hero: content.hero,
    about: content.about,
    doctors,
    services_intro: some(content.services.intro),
    services,
    reviews: content.reviews,
    photos: { logo: one("logo"), hero: one("hero"), about: one("about"), gallery: photos.filter((p) => p.kind === "gallery") },
    social: content.social,
    seo: content.seo,
    booking_enabled: bookingEnabled,
  };
}

export function wireSettings(
  state: Store,
  clinic: FakeClinic,
  site: FakeSite,
  bookingEnabled: boolean,
): C.WebsiteSettings {
  return {
    layout: site.layout,
    template: site.template,
    palette: site.palette,
    fonts: site.fonts,
    content: site.content,
    published: site.published,
    published_at: site.published_at,
    domain: {
      custom_domain: site.custom_domain,
      status: site.domain_status,
      verification_token: site.domain_token,
      checked_at: null,
      sites_target: "aarogyam-site.spring-snow-130f.workers.dev",
      default_address: `${clinic.slug}-site.spring-snow-130f.workers.dev`,
      // The real API queues the address when a site is published and the outbox job makes it work.
      address_status: site.published ? "ready" : "none",
      address_error: null,
    },
    photos: photosOf(state, clinic.id).map(wirePhoto),
    preview: buildPage(state, clinic, site, bookingEnabled),
    doctors: state.practitioners
      .filter((p) => p.clinic_id === clinic.id && p.active)
      .map((p) => ({ id: p.id, name: p.display_name, detail: p.specialty ?? null, fee_paise: null })),
    services: state.priceItems
      .filter((i) => i.clinic_id === clinic.id && i.active && !GOODS.includes(i.category ?? ""))
      .map((i) => ({ id: i.id, name: i.name, detail: i.category ?? null, fee_paise: i.price_paise })),
    templates: SITE_TEMPLATES,
    fonts_available: SITE_FONTS,
  };
}

/** A domain name typed by the owner, cleaned the way the API does; `null` when it isn't one. */
export function parseDomain(text: string): string | null {
  const lower = text.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/+$/, "").replace(/\.$/, "");
  const labels = lower.split(".");
  const labelOk = (l: string) => /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(l);
  const last = labels[labels.length - 1] ?? "";
  return lower.length <= 253 && labels.length >= 2 && labels.every(labelOk) && /[a-z]/.test(last) && last.length >= 2 ? lower : null;
}

const link = (text: string): boolean => text === "" || (/^https:\/\/[^\s<>"'\\]+$/.test(text) && text.length <= 500);

/** The first problem with the changes, as the API reports it (`field`, message), or `null`. */
export function checkChanges(changes: C.WebsiteChanges, site: FakeSite, validDoctors: string[], doctorPhotos: string[]): [string, string] | null {
  const template = changes.template ?? site.template;
  const found = SITE_TEMPLATES.find((t) => t.id === template);
  if (changes.layout != null && changes.layout !== "one" && changes.layout !== "multi") return ["layout", "must be one or multi"];
  if (found === undefined) return ["template", "is not one of the available designs"];
  const palette = changes.palette ?? (changes.template != null && changes.template !== site.template ? found.palettes[0] : site.palette);
  if (palette === undefined || !found.palettes.includes(palette)) return ["palette", "is not one of this design's palettes"];
  if (changes.fonts != null && !SITE_FONTS.includes(changes.fonts)) return ["fonts", "is not one of the font pairings"];
  if (changes.custom_domain != null && changes.custom_domain.trim() !== "" && parseDomain(changes.custom_domain) === null) {
    return ["custom_domain", "must be a domain name such as clinic.example.in"];
  }
  const c = changes.content;
  if (c != null) {
    if (c.hero.headline.length > 120) return ["content.hero.headline", "is too long"];
    if (c.hero.subheadline.length > 240) return ["content.hero.subheadline", "is too long"];
    if (c.about.body.length > 2000) return ["content.about.body", "is too long"];
    if (c.about.highlights.length > 6) return ["content.about.highlights", "has too many entries"];
    if (c.reviews.length > 12) return ["content.reviews", "has too many entries"];
    if (c.reviews.some((r) => r.rating < 1 || r.rating > 5)) return ["content.reviews.rating", "must be 1 to 5"];
    if (c.reviews.some((r) => r.name.trim() === "" || r.text.trim() === "")) return ["content.reviews", "need a name and the review text"];
    for (const [field, value] of [
      ["content.contact.map_url", c.contact.map_url],
      ["content.social.instagram", c.social.instagram],
      ["content.social.facebook", c.social.facebook],
      ["content.social.youtube", c.social.youtube],
    ] as const) {
      if (!link(value.trim())) return [field, "must be a link starting with https://"];
    }
    if (c.contact.email !== "" && !/^[^@\s<>"',]+@[^@\s<>"',]+\.[^@\s<>"',]+$/.test(c.contact.email)) {
      return ["content.contact.email", "is not a valid email address"];
    }
    if (c.contact.whatsapp !== "" && c.contact.whatsapp.replace(/\D/g, "").length < 10) return ["content.contact.whatsapp", "is not a valid phone number"];
    for (const d of c.doctors) {
      if (!validDoctors.includes(d.practitioner_id)) return ["content.doctors", "lists someone who is not a doctor of this clinic"];
      if (d.photo_id != null && !doctorPhotos.includes(d.photo_id)) return ["content.doctors.photo_id", "is not a doctor picture of this clinic"];
    }
  }
  return null;
}

/** Cleans stored content the way the API does: trimmed text, blank bullets dropped, WhatsApp in `E.164`. */
export function cleanContent(c: C.WebsiteContent): C.WebsiteContent {
  const line = (t: string) => t.split(/\s+/).filter((w) => w !== "").join(" ");
  const digits = c.contact.whatsapp.replace(/\D/g, "");
  const whatsapp = digits === "" ? "" : digits.length === 10 ? `+91${digits}` : `+${digits}`;
  return {
    hero: { headline: line(c.hero.headline), subheadline: line(c.hero.subheadline), cta_label: line(c.hero.cta_label) },
    about: { title: line(c.about.title), body: c.about.body.trim(), highlights: c.about.highlights.map(line).filter((h) => h !== "") },
    doctors: c.doctors.map((d) => ({ ...d, qualifications: line(d.qualifications), bio: d.bio.trim() })),
    services: { ...c.services, intro: line(c.services.intro) },
    reviews: c.reviews.map((r) => ({ ...r, name: line(r.name), text: r.text.trim() })),
    contact: { whatsapp, email: c.contact.email.trim(), map_url: c.contact.map_url.trim(), hours_note: line(c.contact.hours_note) },
    social: { instagram: c.social.instagram.trim(), facebook: c.social.facebook.trim(), youtube: c.social.youtube.trim() },
    seo: { title: line(c.seo.title), description: line(c.seo.description) },
  };
}
