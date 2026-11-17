import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import type { StaffSupportGrant } from "@aarogyam/api-client";

import { renderConsole } from "../../test/render-console.js";

const HOUR = 3_600_000;

function grant(id: string, clinic: string, endsInMs: number, extra: Partial<StaffSupportGrant> = {}): StaffSupportGrant {
  const now = Date.now();
  return {
    id,
    access: "read",
    clinic_id: `clinic-${id}`,
    clinic_name: clinic,
    slug: id,
    portal_host: `${id}.localtest.me`,
    reason: `Synthetic reason for ${clinic}`,
    starts_at: new Date(now - HOUR).toISOString(),
    ends_at: new Date(now + endsInMs).toISOString(),
    status: "active",
    granted_by: "Asha Kulkarni",
    ...extra,
  };
}

const failure = { ok: false, error: { status: 403, code: "forbidden", message: "Sakalya staff only." } } as const;

function open(items: StaffSupportGrant[] | "fail") {
  return renderConsole("/support", {
    override: (client) => ({
      ...client,
      listMySupportGrants: () => Promise.resolve(items === "fail" ? failure : { ok: true, value: { items } }),
    }),
  });
}

describe("Support access", () => {
  it("lists active grants with reason, time left, granter and a read-only link to the clinic's host", async () => {
    open([grant("sunrise", "Sunrise Dental", 3.5 * HOUR)]);
    const list = await screen.findByRole("list", { name: "Active grants" });
    expect(within(list).getByText("Sunrise Dental")).toBeTruthy();
    expect(within(list).getByText("Synthetic reason for Sunrise Dental")).toBeTruthy();
    expect(within(list).getByText(/Ends in 3 hours \(.+\) · Granted by Asha Kulkarni/)).toBeTruthy();
    const link = within(list).getByRole("link", { name: /Open clinic \(read-only\)/ });
    expect(link.getAttribute("href")).toBe("https://sunrise.localtest.me/");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(screen.getByText("Access is read-only and every page you open is logged for the clinic.")).toBeTruthy();
  });

  it("puts active grants before past ones and keeps the past ones collapsed", async () => {
    const user = userEvent.setup();
    open([
      grant("old", "Old Clinic", -2 * HOUR, { status: "ended" }),
      grant("gone", "Revoked Clinic", HOUR, { status: "revoked" }),
      grant("live", "Live Clinic", 20 * 60_000 + 5000),
    ]);
    await screen.findByText("Live Clinic");
    const summary = screen.getByText("Past grants (2)");
    expect(summary.closest("details")?.open).toBe(false);
    expect(screen.getByText(/Ends in 20 minutes/)).toBeTruthy();
    const names = screen.getAllByText(/^\w+ Clinic$/).map((n) => n.textContent);
    expect(names).toEqual(["Live Clinic", "Revoked Clinic", "Old Clinic"]);
    await user.click(summary);
    expect(within(screen.getByRole("list", { name: "Past grants" })).getByText("Revoked")).toBeTruthy();
    expect(screen.queryByRole("link", { name: /Revoked Clinic/ })).toBeNull();
  });

  it("says how to get access when there is none", async () => {
    open([]);
    expect(await screen.findByText("No clinic has given you access. Ask the clinic's owner to grant it from Settings → Support access.")).toBeTruthy();
    expect(screen.queryByText(/Past grants/)).toBeNull();
  });

  it("shows an error with a retry when the grants can't load", async () => {
    open("fail");
    expect(await screen.findByText("Couldn't load your support access")).toBeTruthy();
    expect(screen.getByRole("button", { name: /retry|try again/i })).toBeTruthy();
  });

  it("is in the navigation", async () => {
    open([]);
    expect((await screen.findAllByRole("link", { name: "Support access" })).length).toBeGreaterThan(0);
  });
});
