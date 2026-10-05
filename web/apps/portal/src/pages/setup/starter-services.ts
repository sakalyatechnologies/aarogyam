/** A starter price list per specialty: the usual entries with a typical fee, for the owner to tick and edit. */

export interface StarterService {
  name: string;
  /** The category the price list groups by. */
  category: string;
  /** Typical fee in rupees; the owner changes it. */
  rupees: number;
}

const DENTAL: readonly StarterService[] = [
  { name: "Consultation", category: "consultation", rupees: 300 },
  { name: "Dental X-ray (IOPA)", category: "other", rupees: 200 },
  { name: "Scaling and polishing", category: "preventive", rupees: 1200 },
  { name: "Fluoride application", category: "preventive", rupees: 500 },
  { name: "Tooth-coloured filling", category: "restorative", rupees: 1500 },
  { name: "Root canal treatment", category: "endodontics", rupees: 5000 },
  { name: "Crown (per tooth)", category: "restorative", rupees: 4500 },
  { name: "Complete denture", category: "restorative", rupees: 12000 },
  { name: "Tooth extraction", category: "oral_surgery", rupees: 800 },
  { name: "Wisdom tooth removal", category: "oral_surgery", rupees: 4000 },
  { name: "Teeth whitening", category: "preventive", rupees: 6000 },
  { name: "Dental implant", category: "restorative", rupees: 25000 },
  { name: "Braces (full course)", category: "orthodontics", rupees: 35000 },
];

const GENERAL: readonly StarterService[] = [
  { name: "Consultation", category: "consultation", rupees: 400 },
  { name: "Follow-up visit", category: "consultation", rupees: 200 },
  { name: "ECG", category: "other", rupees: 300 },
  { name: "Dressing", category: "other", rupees: 150 },
  { name: "Injection", category: "other", rupees: 100 },
  { name: "Nebulisation", category: "other", rupees: 200 },
];

/** The starter list for a clinic's specialty; an unknown specialty gets the general one. */
export function starterServices(specialty: string): readonly StarterService[] {
  return specialty === "dental" ? DENTAL : GENERAL;
}
