/** The fake's offers: settings, presets, codes. Mirrors `docs/plans/visit-story-v2-offers-design.md` §2.2 closely enough for the UI. */

import type * as C from "../contract.js";
import { paise as toPaise, type IssuedCode, type OfferPresets, type OfferSettings } from "../schemas.js";
import type { FakeOfferCode } from "./fixtures.js";

const p = (n: number) => toPaise.parse(n);
const OWNER_CAPS = { max_percent_bps: 10000, max_fixed_paise: p(1000000), max_valid_days: 365, max_discount_paise: p(500000) };

export const DEFAULT_OFFER_SETTINGS: OfferSettings = {
  patient_offer: { enabled: true, kind: "percent_bps", value: 1000, valid_days: 30 },
  referral: {
    enabled: true,
    friend_kind: "percent_bps",
    friend_value: 1000,
    friend_max_discount_paise: p(200000),
    valid_days: 60,
    max_uses: 5,
    reward: { enabled: true, kind: "percent_bps", value: 1000, valid_days: 90, max_per_month: 3, min_bill_paise: p(50000), max_discount_paise: p(200000) },
  },
  caps: { default: { max_percent_bps: 2000, max_fixed_paise: p(200000), max_valid_days: 90, max_discount_paise: p(200000) }, owner: OWNER_CAPS, by_role: [] },
};

type Problem = { field: string; message: string };

/** A refusal's field and message, or null when the settings are fine. */
export function offerSettingsProblem(s: OfferSettings): Problem | null {
  const bad = (field: string, message: string): Problem => ({ field, message });
  const value = (field: string, kind: string, v: number): Problem | null =>
    kind === "percent_bps" ? (v >= 1 && v <= 10000 ? null : bad(field, "must be 1 to 10000")) : v >= 100 && v <= 10000000 ? null : bad(field, "must be 100 to 10000000");
  const paise = (field: string, v: number): Problem | null => (v >= 100 && v <= 10000000 ? null : bad(field, "must be 100 to 10000000"));
  const days = (field: string, v: number): Problem | null => (v >= 1 && v <= 365 ? null : bad(field, "must be 1 to 365"));
  const caps = (path: string, c: OfferSettings["caps"]["default"]): Problem | null =>
    value(`${path}.max_percent_bps`, "percent_bps", c.max_percent_bps) ??
    paise(`${path}.max_fixed_paise`, c.max_fixed_paise) ??
    days(`${path}.max_valid_days`, c.max_valid_days) ??
    paise(`${path}.max_discount_paise`, c.max_discount_paise);
  const r = s.referral;
  return (
    value("patient_offer.value", s.patient_offer.kind, s.patient_offer.value) ??
    days("patient_offer.valid_days", s.patient_offer.valid_days) ??
    value("referral.friend_value", r.friend_kind, r.friend_value) ??
    paise("referral.friend_max_discount_paise", r.friend_max_discount_paise) ??
    days("referral.valid_days", r.valid_days) ??
    value("referral.reward.value", r.reward.kind, r.reward.value) ??
    paise("referral.reward.max_discount_paise", r.reward.max_discount_paise) ??
    caps("caps.default", s.caps.default) ??
    caps("caps.owner", s.caps.owner) ??
    (s.caps.by_role.length > 50 ? bad("caps.by_role", "at most 50 roles") : null)
  );
}

/** The presets for a caller: the clinic's presets lowered to their caps. */
export function presetsFor(s: OfferSettings, owner: boolean): OfferPresets {
  const caps = owner ? s.caps.owner : s.caps.default;
  const offer = s.patient_offer;
  const cap = (kind: string, v: number) => Math.min(v, kind === "percent_bps" ? caps.max_percent_bps : caps.max_fixed_paise);
  return {
    offer_enabled: offer.enabled,
    offer_kind: offer.kind,
    offer_value: cap(offer.kind, offer.value),
    offer_valid_days: Math.min(offer.valid_days, caps.max_valid_days),
    offer_max_discount_paise: offer.kind === "percent_bps" ? caps.max_discount_paise : null,
    referral_enabled: s.referral.enabled,
    referral_kind: s.referral.friend_kind,
    referral_value: cap(s.referral.friend_kind, s.referral.friend_value),
    referral_max_discount_paise: p(Math.min(s.referral.friend_max_discount_paise, caps.max_discount_paise)),
    referral_valid_days: Math.min(s.referral.valid_days, caps.max_valid_days),
    max_percent_bps: caps.max_percent_bps,
    max_fixed_paise: caps.max_fixed_paise,
    max_valid_days: caps.max_valid_days,
  };
}

export function wireCode(code: FakeOfferCode): IssuedCode {
  return { id: code.id, code: code.code, purpose: code.purpose, kind: code.kind, value: code.value, max_discount_paise: code.max_discount_paise === null ? null : p(code.max_discount_paise), valid_to: code.valid_to };
}

/** A code like `K7QM-4XRD` from the fake's random source. */
export function makeCode(random: () => number): string {
  const alphabet = "ABCDEFGHJKMNPQRSTVWXYZ23456789";
  const pick = () => alphabet.charAt(Math.floor(random() * alphabet.length));
  return `${Array.from({ length: 4 }, pick).join("")}-${Array.from({ length: 4 }, pick).join("")}`;
}

/** What `POST /visits/{id}/offers` asks for, checked against the caller's presets and caps. */
export function offerTerms(input: C.NewPatientOffer, presets: OfferPresets): { kind: string; value: number; days: number } | Problem {
  const kind = input.kind ?? presets.offer_kind;
  const value = input.value ?? presets.offer_value;
  const days = input.valid_days ?? presets.offer_valid_days;
  if (value > (kind === "percent_bps" ? presets.max_percent_bps : presets.max_fixed_paise)) {
    return { field: "value", message: "over your limit" };
  }
  if (days > presets.max_valid_days) {
    return { field: "valid_days", message: "over your limit" };
  }
  return { kind, value, days };
}
