import { describe, expect, it } from "vitest";

import { clinicId, type ConsoleClinic } from "@aarogyam/api-client";

import { countClinics, expiryNote, filterClinics } from "./clinics-view.js";

const clinic = (name: string, status: ConsoleClinic["status"], specialty = "dental"): ConsoleClinic => {
  const slug = name.toLowerCase().replace(/\s/g, "-");
  return {
    id: clinicId.parse(slug),
    name,
    status,
    specialty,
    slug,
    portal_host: `${slug}.aarogyam.example`,
    created_at: "2026-10-01T00:00:00Z",
    active_members: 1,
    patients: 0,
  };
};

const ITEMS = [clinic("Sunrise Dental", "active"), clinic("Lotus Clinic", "trial", "general"), clinic("Old Dental", "churned")];

describe("clinics view", () => {
  it("counts clinics by status", () => {
    expect(countClinics(ITEMS)).toEqual({ all: 3, active: 1, trial: 1, suspended: 0, churned: 1 });
  });
  it("filters by status, specialty and name or address", () => {
    const base = { status: "all", specialty: "all", query: "" } as const;
    expect(filterClinics(ITEMS, { ...base, status: "trial" }).map((c) => c.name)).toEqual(["Lotus Clinic"]);
    expect(filterClinics(ITEMS, { ...base, specialty: "dental" })).toHaveLength(2);
    expect(filterClinics(ITEMS, { ...base, query: "SUNRISE-DENTAL.aarogyam" })).toHaveLength(1);
  });
  it("describes how long an invitation has left", () => {
    const now = new Date("2026-10-03T00:00:00Z");
    expect(expiryNote("2026-10-06T00:00:00Z", now)).toEqual({ text: "Expires in 3 days", expired: false });
    expect(expiryNote("2026-10-03T10:00:00Z", now).text).toBe("Expires today");
    expect(expiryNote("2026-10-01T00:00:00Z", now)).toEqual({ text: "Expired 2 days ago", expired: true });
  });
});
