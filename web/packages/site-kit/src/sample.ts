/** A complete example page, for tests and for trying the designs without a clinic. */

import type { SitePage } from "@aarogyam/api-client";

export function sampleSite(overrides: Partial<SitePage> = {}): SitePage {
  const photo = (id: string, kind: "logo" | "hero" | "about" | "doctor" | "gallery", alt: string) => ({ id, kind, url: `/api/v1/public/site/photos/${id}`, alt });
  return {
    design: { layout: "one", template: "aurora", palette: "gold", fonts: "modern" },
    clinic: {
      name: "Sunrise Dental Clinic",
      brand: "#0f766e",
      address: { line1: "12 MG Road", line2: "Near City Mall", city: "Pune", state: "Maharashtra", pincode: "411001" },
      phone: "+912026123456",
      whatsapp: "+919876543210",
      email: "hello@sunrise.example",
      map_url: null,
    },
    hours: [
      { weekday: 1, spans: [["09:00", "13:00"], ["16:00", "20:00"]] },
      { weekday: 2, spans: [["09:00", "13:00"], ["16:00", "20:00"]] },
      { weekday: 3, spans: [["09:00", "13:00"], ["16:00", "20:00"]] },
      { weekday: 4, spans: [["09:00", "13:00"], ["16:00", "20:00"]] },
      { weekday: 5, spans: [["09:00", "13:00"], ["16:00", "20:00"]] },
      { weekday: 6, spans: [["09:00", "14:00"]] },
    ],
    hours_note: "Closed on public holidays",
    hero: { headline: "", subheadline: "", cta_label: "" },
    about: { title: "", body: "", highlights: [] },
    doctors: [
      { id: "d1", name: "Dr Asha Rao", specialty: "Orthodontics", qualifications: "BDS, MDS (Orthodontics)", bio: "Twelve years of straightening smiles.", photo: photo("p1", "doctor", "Dr Asha Rao smiling") },
      { id: "d2", name: "Dr Dev Kulkarni", specialty: "Endodontics", qualifications: "BDS, MDS", bio: null, photo: null },
    ],
    services_intro: null,
    services: [
      { id: "s1", name: "Check-up and cleaning", category: "preventive", fee_paise: 80_000, description: "Every six months." },
      { id: "s2", name: "Tooth-coloured filling", category: "restorative", fee_paise: 150_000, description: null },
      { id: "s3", name: "Root canal treatment", category: "endodontics", fee_paise: 650_000, description: null },
      { id: "s4", name: "Zirconia crown", category: "restorative", fee_paise: 1_250_000, description: null },
      { id: "s5", name: "Braces consultation", category: "orthodontics", fee_paise: 50_000, description: null },
      { id: "s6", name: "Teeth whitening", category: "cosmetic", fee_paise: 1_000_000, description: null },
      { id: "s7", name: "Wisdom tooth removal", category: "surgery", fee_paise: 400_000, description: null },
    ],
    reviews: [
      { name: "Priya N.", rating: 5, text: "Kind, quick and clear about the fees." },
      { name: "Rahul S.", rating: 5, text: "My son was not scared at all." },
    ],
    photos: {
      logo: null,
      hero: photo("h1", "hero", "The reception"),
      about: photo("a1", "about", "The treatment room"),
      gallery: [photo("g1", "gallery", "Waiting area"), photo("g2", "gallery", "Chair one")],
    },
    social: { instagram: "https://instagram.com/sunrise", facebook: "", youtube: "" },
    seo: { title: "", description: "" },
    booking_enabled: true,
    ...overrides,
  };
}
