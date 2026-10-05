/** The wording a page shows where the owner has not written their own. */

import type { SitePage } from "@aarogyam/api-client";

import { addressLines } from "./format.js";

export interface Copy {
  headline: string;
  subheadline: string;
  cta: string;
  aboutTitle: string;
  aboutBody: string;
  highlights: string[];
  servicesIntro: string;
  hoursNote: string;
}

const city = (site: SitePage): string => site.clinic.address.city ?? "";

export function defaultCopy(site: SitePage): Copy {
  const name = site.clinic.name;
  const place = city(site);
  return {
    headline: "Healthy smiles, gently cared for",
    subheadline: `${name} brings clear treatment plans, honest fees and easy online booking${place === "" ? "" : ` to ${place}`}.`,
    cta: "Book an appointment",
    aboutTitle: `About ${name}`,
    aboutBody: `At ${name}, every visit starts with listening. We explain your options in plain words, agree a plan with you, and keep fees clear before any treatment begins.\n\nWhether you come for a check-up or a longer treatment, you will see the same caring team and leave knowing exactly what comes next.`,
    highlights: ["Clear treatment plans", "Fees explained upfront", "Easy online booking"],
    servicesIntro: "Treatments and fees, listed plainly.",
    hoursNote: "",
  };
}

export interface Resolved {
  headline: string;
  subheadline: string;
  cta: string;
  aboutTitle: string;
  aboutBody: string;
  highlights: string[];
  servicesIntro: string;
  hoursNote: string;
  /** Which of these still show the default wording. */
  isDefault: Record<keyof Copy, boolean>;
}

/** The text to show for each part: the owner's, or the default when they left it empty. */
export function resolveCopy(site: SitePage): Resolved {
  const d = defaultCopy(site);
  const pick = (own: string | null | undefined, fallback: string): [string, boolean] =>
    own != null && own.trim() !== "" ? [own, false] : [fallback, true];
  const [headline, hd] = pick(site.hero.headline, d.headline);
  const [subheadline, sd] = pick(site.hero.subheadline, d.subheadline);
  const [cta, cd] = pick(site.hero.cta_label, d.cta);
  const [aboutTitle, atd] = pick(site.about.title, d.aboutTitle);
  const [aboutBody, abd] = pick(site.about.body, d.aboutBody);
  const [servicesIntro, sid] = pick(site.services_intro, d.servicesIntro);
  const [hoursNote, hnd] = pick(site.hours_note, d.hoursNote);
  const own = site.about.highlights.filter((h) => h.trim() !== "");
  return {
    headline,
    subheadline,
    cta,
    aboutTitle,
    aboutBody,
    highlights: own.length > 0 ? own : d.highlights,
    servicesIntro,
    hoursNote,
    isDefault: {
      headline: hd,
      subheadline: sd,
      cta: cd,
      aboutTitle: atd,
      aboutBody: abd,
      highlights: own.length === 0,
      servicesIntro: sid,
      hoursNote: hnd,
    },
  };
}

/** Where the clinic is, in a few words, for the footer and search results. */
export function placeLine(site: SitePage): string {
  return addressLines(site.clinic.address).slice(-1).join("");
}
