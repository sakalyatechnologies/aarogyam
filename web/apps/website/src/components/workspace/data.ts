// Sample clinic data for the interactive dentist workspace demo (from the reference dashboard).
export type Patient = {
  n: string; f: string; age: number; last: string; next: string; bal: number;
  flags: string; alert?: boolean; consent: boolean; visits: [string, string, string][];
};

export const patients: Patient[] = [
  { n: "Meera Shah", f: "SC-1042", age: 34, last: "Today 9:00", next: "4 Apr · review", bal: 0, flags: "Penicillin allergy · confirm before prescribing", alert: true, consent: true, visits: [["Today", "Root canal review", "₹8,500"], ["12 Sep", "Crown prep", "₹14,000"]] },
  { n: "Arjun Nair", f: "SC-2091", age: 28, last: "Today 9:30", next: "—", bal: 0, flags: "None recorded", consent: true, visits: [["Today", "Cleaning + polish", "₹1,800"], ["2 Aug", "Filling", "₹2,400"]] },
  { n: "Kavya Reddy", f: "SC-0871", age: 16, last: "Today 10:15", next: "Today 10:15", bal: 4200, flags: "Braces · elastic compliance low", consent: true, visits: [["Today", "Braces adjustment", "₹4,200"], ["5 Sep", "Braces tightening", "₹3,500"]] },
  { n: "Rohan Iyer", f: "SC-1560", age: 41, last: "28 Sep", next: "Today 10:45", bal: 0, flags: "Hypertension · BP check at visit", alert: true, consent: true, visits: [["28 Sep", "Crown trial", "₹6,000"], ["10 Sep", "RCT sitting 2", "₹9,500"]] },
  { n: "Fatima Khan", f: "SC-2210", age: 52, last: "—", next: "Today 11:30", bal: 0, flags: "New patient · sensitivity complaint", consent: false, visits: [] },
  { n: "Vikram Rao", f: "SC-0934", age: 60, last: "20 Sep", next: "Today 12:15", bal: 3800, flags: "Diabetic · morning slots preferred", alert: true, consent: true, visits: [["20 Sep", "Implant check", "₹3,800"], ["30 Aug", "Implant stage 2", "₹28,000"]] },
  { n: "Sana Sheikh", f: "SC-1742", age: 25, last: "26 Sep", next: "10 Oct", bal: 2600, flags: "None recorded", consent: true, visits: [["26 Sep", "Whitening", "₹5,200"]] },
];

export type ApptState = "done" | "chair" | "waiting" | "booked";
export const schedule: { t: string; p: string; what: string; chair: string; mins: number; s: ApptState }[] = [
  { t: "09:00", p: "Meera Shah", what: "Root canal review", chair: "Chair 1", mins: 30, s: "done" },
  { t: "09:30", p: "Arjun Nair", what: "Cleaning + polish", chair: "Chair 2", mins: 45, s: "done" },
  { t: "10:15", p: "Kavya Reddy", what: "Braces adjustment", chair: "Chair 3", mins: 30, s: "chair" },
  { t: "10:45", p: "Rohan Iyer", what: "Crown fit · lab work arrived", chair: "Chair 1", mins: 45, s: "waiting" },
  { t: "11:30", p: "Fatima Khan", what: "New consult · sensitivity", chair: "Chair 2", mins: 30, s: "waiting" },
  { t: "12:15", p: "Vikram Rao", what: "Implant check", chair: "Chair 1", mins: 30, s: "booked" },
  { t: "14:00", p: "Sana Sheikh", what: "Whitening session 2", chair: "Chair 2", mins: 60, s: "booked" },
];

export const hours: [string, number, boolean][] = [["9a", 6, true], ["10a", 9, true], ["11a", 7, false], ["12p", 5, false], ["1p", 3, false], ["2p", 6, false], ["3p", 8, false], ["4p", 7, false], ["5p", 9, false], ["6p", 6, false]];

export const invoices: [string, string, string, string, "PAID" | "DUE" | "PARTIAL"][] = [
  ["SC/26-27/000318", "Meera Shah", "₹8,500", "UPI", "PAID"],
  ["SC/26-27/000317", "Arjun Nair", "₹1,800", "Card", "PAID"],
  ["SC/26-27/000316", "Kavya Reddy", "₹4,200", "—", "DUE"],
  ["SC/26-27/000315", "Vikram Rao", "₹3,800", "—", "DUE"],
  ["SC/26-27/000314", "Sana Sheikh", "₹2,600", "UPI", "PARTIAL"],
];
export const weekly = [42, 55, 48, 61, 58, 66, 72, 69];

export const stock: [string, string, number, number][] = [
  ["Composite A2", "Restorative", 4, 40], ["Brackets 022", "Ortho", 32, 60], ["Implant 4.2×10", "Surgical", 12, 30],
  ["Gloves (box)", "Disposables", 58, 100], ["Anesthetic cartridges", "Anesthesia", 22, 50], ["Polish cups", "Disposables", 9, 40],
];

export const labCases: { p: string; item: string; lab: string; due: string; stage: 0 | 1 | 2 | 3 }[] = [
  { p: "Rohan Iyer", item: "PFM crown · 36", lab: "Precision Dental Lab", due: "Arrived today", stage: 3 },
  { p: "Kavya Reddy", item: "Retainer impression", lab: "OrthoCraft", due: "8 Oct", stage: 1 },
  { p: "Vikram Rao", item: "Implant crown · 46", lab: "Precision Dental Lab", due: "12 Oct", stage: 2 },
  { p: "Meera Shah", item: "Zirconia crown · 21", lab: "SmileWorks", due: "15 Oct", stage: 0 },
];

export const templates: [string, string, string][] = [
  ["Appointment reminder", "24h + 2h before · WhatsApp", "Hi {name}, a reminder of your visit at Smile Catchers tomorrow at {time}. Reply 1 to confirm."],
  ["Payment receipt", "Auto on collection · SMS + WhatsApp", "Thank you {name}. We received your payment. Your receipt is attached."],
  ["Recall: 6-month cleaning", "Promotional · opt-in needed", "Hi {name}, it's been 6 months since your last cleaning. Shall we book you in?"],
  ["Post-extraction care", "Sent after surgery", "Bite on the gauze for 30 minutes. Avoid hot food today. Call us if bleeding continues."],
];

export type ToothState = "healthy" | "caries" | "rct" | "crown" | "missing" | "implant";
export const toothStates: { k: ToothState; label: string }[] = [
  { k: "healthy", label: "Healthy" }, { k: "caries", label: "Caries" }, { k: "rct", label: "Root canal" },
  { k: "crown", label: "Crown" }, { k: "missing", label: "Missing" }, { k: "implant", label: "Implant" },
];
