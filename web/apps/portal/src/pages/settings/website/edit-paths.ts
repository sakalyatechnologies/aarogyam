/** Maps a click-to-edit path from the preview onto the stored content, and shows content in the preview at once. */

import type { SitePage, WebsiteContent } from "@aarogyam/api-client";
import { defaultCopy } from "@aarogyam/site-kit";

/** The content after the owner edits the text at `path`, or `null` for a path that isn't editable. */
export function applyText(content: WebsiteContent, site: SitePage, path: string, value: string): WebsiteContent | null {
  const next = structuredClone(content);
  const [section, a, b] = path.split(".");
  if (section === "hero" && (a === "headline" || a === "subheadline" || a === "cta_label")) {
    next.hero[a] = value;
    return next;
  }
  if (section === "about" && (a === "title" || a === "body")) {
    next.about[a] = value;
    return next;
  }
  if (section === "about" && a === "highlights" && b !== undefined) {
    const index = Number(b);
    const base = next.about.highlights.length > 0 ? next.about.highlights : defaultCopy(site).highlights;
    const list = [...base];
    if (value === "") {
      list.splice(index, 1);
    } else {
      list[index] = value;
    }
    next.about.highlights = list;
    return next;
  }
  if (section === "services" && a === "intro") {
    next.services.intro = value;
    return next;
  }
  if (section === "hours_note") {
    next.contact.hours_note = value;
    return next;
  }
  if (section === "doctors" && a !== undefined && (b === "bio" || b === "qualifications")) {
    let profile = next.doctors.find((d) => d.practitioner_id === a);
    if (profile === undefined) {
      profile = { practitioner_id: a, qualifications: "", bio: "", photo_id: null, hidden: false };
      next.doctors.push(profile);
    }
    profile[b] = value;
    return next;
  }
  if (section === "reviews" && a !== undefined && (b === "text" || b === "name")) {
    const review = next.reviews[Number(a)];
    if (review === undefined) {
      return null;
    }
    review[b] = value;
    return next;
  }
  return null;
}

const orNull = (text: string): string | null => (text.trim() === "" ? null : text);

/** The preview with the draft's text laid over it, so typing shows before the server answers. */
export function overlay(preview: SitePage, content: WebsiteContent): SitePage {
  return {
    ...preview,
    hero: content.hero,
    about: content.about,
    services_intro: orNull(content.services.intro),
    hours_note: orNull(content.contact.hours_note),
    reviews: content.reviews,
    social: content.social,
    seo: content.seo,
    doctors: preview.doctors.map((d) => {
      const profile = content.doctors.find((p) => p.practitioner_id === d.id);
      return { ...d, qualifications: orNull(profile?.qualifications ?? ""), bio: orNull(profile?.bio ?? "") };
    }),
  };
}
