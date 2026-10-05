import { describe, expect, it } from "vitest";

import { application, type Application } from "@aarogyam/api-client";

import { countByStatus, filterApplications, reasonProblem } from "./applications-view.js";

const app = (clinic_name: string, status: string, specialty = "dental", city = "Pune"): Application =>
  application.parse({
    id: clinic_name,
    clinic_name,
    status,
    specialty,
    city,
    contact_name: "Asha Rao",
    email: `${clinic_name.split(" ")[0]?.toLowerCase() ?? ""}@x.example`,
    submissions: 1,
    created_at: "2026-10-01T00:00:00Z",
    updated_at: "2026-10-01T00:00:00Z",
  });

const ITEMS = [app("Smile Care", "pending"), app("Riverside Dental", "pending", "dental", "Nashik"), app("Wellness General", "approved", "general"), app("Old One", "rejected")];

describe("applications view", () => {
  it("counts each status", () => {
    expect(countByStatus(ITEMS)).toEqual({ pending: 2, approved: 1, rejected: 1, all: 4 });
  });

  it("filters by status, specialty and a search over clinic, city and email", () => {
    const base = { status: "all", specialty: "all", query: "" } as const;
    expect(filterApplications(ITEMS, { ...base, status: "pending" })).toHaveLength(2);
    expect(filterApplications(ITEMS, { ...base, specialty: "general" }).map((a) => a.clinic_name)).toEqual(["Wellness General"]);
    expect(filterApplications(ITEMS, { ...base, query: " nashik " }).map((a) => a.clinic_name)).toEqual(["Riverside Dental"]);
    expect(filterApplications(ITEMS, { ...base, query: "smile@" })).toHaveLength(1);
    expect(filterApplications(ITEMS, { ...base, status: "approved", query: "smile" })).toEqual([]);
  });

  it("requires a real reason to reject", () => {
    expect(reasonProblem("  ")).toBeDefined();
    expect(reasonProblem("Duplicate application")).toBeUndefined();
  });
});
