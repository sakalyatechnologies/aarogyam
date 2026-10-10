import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { beforeEach, describe, expect, it } from "vitest";

import type { ApiClient, DashboardLayout } from "@aarogyam/api-client";
import { fakeTokenFor, freshSetup, type Fixtures } from "@aarogyam/api-client/fake";

import { CLINIC_STORAGE_KEY } from "../../clinic.js";
import { NEW_LOOK_KEY } from "../../lib/new-look.js";
import { NOW, PEOPLE, fakeApi, renderPortal } from "../../test/render.js";

const SUNRISE = "sunrise.localtest.me";

/** Sunrise as a brand-new clinic: nothing answered, and Dev not yet through his own screen. */
function freshClinic(fixtures: Fixtures) {
  const clinic = fixtures.clinics.find((c) => c.host === SUNRISE);
  const dev = fixtures.memberships.find((m) => m.user_id === PEOPLE.dev && m.clinic_id === clinic?.id);
  if (clinic === undefined || dev === undefined) throw new Error("expected Sunrise and Dev");
  fixtures.setups = [freshSetup(`clinic:${clinic.id}`), freshSetup(`member:${dev.id}`)];
}

function client(backend: ReturnType<typeof fakeApi>, as: string) {
  return backend.client({
    host: SUNRISE,
    getToken: () => fakeTokenFor({ id: as }),
    now: () => NOW,
  });
}

function value<T>(result: { ok: true; value: T } | { ok: false; error: { message: string } }): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

function input(element: HTMLElement | undefined): string {
  if (!(element instanceof HTMLInputElement)) throw new Error("expected an input");
  return element.value;
}

function doctorRow(display: string): HTMLElement {
  const row = screen.getAllByRole("listitem").find((li) => within(li).queryByDisplayValue(display) !== null);
  if (row === undefined) throw new Error(`expected a row for ${display}`);
  return row;
}

function first(elements: HTMLElement[]): HTMLElement {
  const element = elements[0];
  if (element === undefined) throw new Error("expected an element");
  return element;
}

async function wizard(path = "/today", wrap?: (client: ApiClient) => ApiClient) {
  const user = userEvent.setup();
  const backend = fakeApi(freshClinic);
  renderPortal(path, { as: PEOPLE.asha, backend, ...(wrap === undefined ? {} : { wrap }) });
  // The first run loads who you are, then the session, Today, the setup state and the redirect: allow it time.
  await screen.findByRole("heading", { name: "Set up your clinic" }, { timeout: 5000 });
  if (path === "/today") {
    await screen.findByLabelText("Clinic name", {}, { timeout: 5000 });
  }
  return { user, backend };
}

async function continueTo(user: ReturnType<typeof userEvent.setup>, label: string | RegExp) {
  await user.click(
    screen.getByRole("button", {
      name: /Save and continue|^Continue$|Add to price list|Send invitations/,
    }),
  );
  await screen.findByRole("heading", { name: label });
}

beforeEach(() => {
  window.sessionStorage.clear();
  window.localStorage.clear();
});

describe("Setup wizard", () => {
  it("opens the first time the owner reaches Today, on step 1, prefilled", async () => {
    await wizard();
    expect(screen.getByText(/Step 1 of 5/)).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Your clinic" })).toBeTruthy();
    expect(input(screen.getByLabelText("Clinic name"))).toBe("Sunrise Dental");
    expect(input(screen.getByLabelText("Address"))).toBe("12 Church Road");
    expect(screen.getByText("Dental clinic")).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "Setup steps" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Your clinic/ }).getAttribute("aria-current")).toBe("step");
  });

  it("step 1 saves the clinic and how it practises, then moves on", async () => {
    const { user, backend } = await wizard();
    const phone = screen.getByLabelText("Phone");
    await user.clear(phone);
    await user.type(phone, "9876543210");
    await user.click(screen.getByRole("radio", { name: /Several doctors/ }));
    await continueTo(user, "Hours and doctors");
    const owner = client(backend, PEOPLE.asha);
    expect(value(await owner.getClinicSettings()).phone).toBe("+919876543210");
    const setup = value(await owner.getSetup());
    expect(setup.practice).toBe("multi");
    expect(setup.steps[0]).toEqual({ key: "clinic", status: "done" });
  });

  it("step 1 shows what the API refuses, next to the field, and stays put", async () => {
    const { user } = await wizard();
    const name = screen.getByLabelText("Clinic name");
    await user.clear(name);
    expect(screen.getByRole("button", { name: "Save and continue" }).hasAttribute("disabled")).toBe(true);
    await user.type(name, "Sunrise Dental");
    const phone = screen.getByLabelText("Phone");
    await user.clear(phone);
    await user.type(phone, "12");
    await user.click(screen.getByRole("button", { name: "Save and continue" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/phone/i);
    expect(screen.getByRole("heading", { name: "Your clinic" })).toBeTruthy();
  });

  it("step 2 has the owner as the first doctor, takes split shifts, and saves doctors and hours", async () => {
    const { user, backend } = await wizard("/setup?step=hours");
    await screen.findByRole("heading", { name: "Hours and doctors" });
    const name = await screen.findAllByLabelText("Name");
    expect(input(name[0])).toBe("Asha Kulkarni");
    // Asha is already a doctor at Sunrise in the demo data: her record, not a second one.
    const qualifications = first(screen.getAllByLabelText("Qualifications"));
    await user.type(qualifications, "BDS, MDS");
    await user.type(first(screen.getAllByLabelText("Registration number")), "MH-2041");
    // Monday becomes a split day: morning 9 to 1, evening 5 to 8.
    fireEvent.change(screen.getByLabelText("Monday end"), {
      target: { value: "13:00" },
    });
    await user.click(screen.getByRole("button", { name: /Add Monday.s evening shift/ }));
    fireEvent.change(screen.getByLabelText("Monday second shift start"), {
      target: { value: "17:00" },
    });
    fireEvent.change(screen.getByLabelText("Monday second shift end"), {
      target: { value: "20:00" },
    });
    await continueTo(user, "Services and fees");
    const owner = client(backend, PEOPLE.asha);
    const doctors = value(await owner.listPractitioners()).items.filter((d) => d.display_name === "Asha Kulkarni");
    expect(doctors).toHaveLength(1);
    expect(doctors[0]).toMatchObject({
      qualifications: "BDS, MDS",
      registration_number: "MH-2041",
    });
    const doctor = doctors[0];
    if (doctor === undefined) throw new Error("expected Asha's record");
    const hours = value(await owner.getWorkingHours(doctor.id));
    expect(hours.shifts.filter((s) => s.weekday === 1).map((s) => [s.starts, s.ends])).toEqual([
      ["09:00", "13:00"],
      ["17:00", "20:00"],
    ]);
  });

  it("step 2 refuses overlapping shifts before saving", async () => {
    const { user } = await wizard("/setup?step=hours");
    await user.click(await screen.findByRole("button", { name: /Add Monday.s evening shift/ }));
    fireEvent.change(screen.getByLabelText("Monday second shift start"), {
      target: { value: "12:00" },
    });
    await user.click(screen.getByRole("button", { name: "Save and continue" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Monday: the two shifts overlap.");
  });

  it("step 3 offers a letterhead upload or a generated design, with a live preview, and can be skipped", async () => {
    const { user, backend } = await wizard("/setup?step=look");
    expect(await screen.findByRole("radiogroup", { name: "Letterhead source" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: /My own letterhead/ })).toBeTruthy();
    expect(screen.getByRole("radiogroup", { name: "Palette" })).toBeTruthy();
    // The same Today board the Studio draws, on sample data, with its widget editor and a template card each.
    expect(await screen.findByRole("group", { name: "Live preview of Today" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remove Key numbers" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Executive/ })).toBeTruthy();
    expect(document.querySelectorAll(".tv2-thumb").length).toBeGreaterThan(2);
    const preview = screen.getByRole("group", { name: "Live preview of Today" });
    await waitFor(() => { expect(within(preview).getAllByText(/Meera/).length).toBeGreaterThan(0); });
    expect(within(preview).queryByText(/Couldn't load/)).toBeNull();
    await user.click(screen.getByRole("button", { name: "Skip this step" }));
    await screen.findByRole("heading", { name: /Good (morning|afternoon|evening)/ }).catch(() => undefined);
    const setup = value(await client(backend, PEOPLE.asha).getSetup());
    expect(setup.steps.find((s) => s.key === "look")?.status).toBe("skipped");
  });

  it("step 4 starts from the specialty's list, and adds what stays ticked", async () => {
    const { user, backend } = await wizard("/setup?step=services");
    await screen.findByRole("heading", { name: "Services and fees" });
    const owner = client(backend, PEOPLE.asha);
    const before = value(await owner.listPriceItems()).items.length;
    // Untick one, change another's fee.
    await user.click(await screen.findByRole("checkbox", { name: "Offer Dental implant" }));
    const fee = screen.getByLabelText("Fee for Fluoride application in rupees");
    await user.clear(fee);
    await user.type(fee, "700");
    await continueTo(user, "Team and patients");
    const after = value(await owner.listPriceItems()).items;
    expect(after.some((p) => p.name === "Dental implant")).toBe(false);
    expect(after.find((p) => p.name === "Fluoride application")?.price_paise).toBe(70_000);
    expect(after.length).toBeGreaterThan(before);
  });

  it("step 5 invites by email and role and points at the patient import", async () => {
    const { user, backend } = await wizard("/setup?step=team");
    await screen.findByRole("heading", { name: "Team and patients" });
    await user.type(await screen.findByLabelText("Email of person 1"), "new.desk@example.com");
    await user.click(screen.getByRole("button", { name: "Send invitations" }));
    expect((await screen.findByRole("alert")).textContent).toContain("role");
    await user.selectOptions(screen.getByLabelText("Role of person 1"), "front_desk");
    expect(screen.getByRole("link", { name: "Open the importer" }).getAttribute("href")).toBe("/patients/import");
    await user.click(screen.getByRole("button", { name: "Send invitations" }));
    await screen.findByRole("heading", { name: "Your look" });
    const staff = value(await client(backend, PEOPLE.asha).listStaff());
    expect(JSON.stringify(staff)).toContain("new.desk@example.com");
  });

  it("shows only the setup while it is unfinished, then the dashboard after the last step", async () => {
    const { user } = await wizard();
    // No sidebar, no dashboard, no nagging card.
    expect(screen.queryByRole("navigation", { name: /Main|Primary/ })).toBeNull();
    expect(screen.queryByRole("link", { name: /Billing/ })).toBeNull();
    expect(screen.queryByRole("region", { name: "Finish setting up" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Finish later" })).toBeNull();
    for (let step = 1; step <= 5; step += 1) {
      await screen.findByText(new RegExp(`Step ${String(step)} of 5`));
      if (step === 5) {
        expect(screen.getByRole("heading", { name: "Your look" })).toBeTruthy();
      }
      await user.click(await screen.findByRole("button", { name: "Skip this step" }));
    }
    await screen.findByRole("link", { name: /Billing/ }, { timeout: 5000 });
    expect(screen.queryByRole("heading", { name: "Set up your clinic" })).toBeNull();
  });

  it("keeps the owner in the setup from any address, and resumes at the first unanswered step", async () => {
    const backend = fakeApi(freshClinic);
    const owner = client(backend, PEOPLE.asha);
    await owner.updateSetup({ step: "clinic", status: "done" });
    await owner.updateSetup({ step: "hours", status: "skipped" });
    renderPortal("/billing", { as: PEOPLE.asha, backend });
    await screen.findByRole("heading", { name: "Services and fees" }, { timeout: 5000 });
    expect(screen.getByText(/Step 3 of 5/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Hours and doctors/ }).textContent).toContain("Skipped");
    expect(screen.queryByRole("link", { name: /Billing/ })).toBeNull();
  });

  it("an owner who finished setup, or dismissed it earlier, goes straight to the dashboard", async () => {
    const backend = fakeApi(freshClinic);
    const owner = client(backend, PEOPLE.asha);
    await owner.updateSetup({ dismissed: true });
    renderPortal("/billing", { as: PEOPLE.asha, backend });
    await screen.findByRole("link", { name: /Billing/ }, { timeout: 5000 });
    expect(screen.queryByRole("heading", { name: "Set up your clinic" })).toBeNull();
  });

  it("clinics set up before the wizard are not sent to it", async () => {
    renderPortal("/today", { as: PEOPLE.asha });
    await screen.findByRole("heading", { name: /Good (morning|afternoon|evening)/ }).catch(() => undefined);
    expect(screen.queryByRole("heading", { name: "Set up your clinic" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Finish setting up" })).toBeNull();
  });

  it("step 2 adds a doctor with an invitation email, and removes one with no appointments", async () => {
    const { user, backend } = await wizard("/setup?step=hours");
    await screen.findByRole("heading", { name: "Hours and doctors" });
    await user.click(await screen.findByRole("button", { name: /Add doctor/ }));
    const names = screen.getAllByLabelText("Name");
    const added = names[names.length - 1];
    if (added === undefined) throw new Error("expected a new row");
    await user.type(added, "Dr Meera Joshi");
    const quals = screen.getAllByLabelText("Qualifications");
    await user.type(quals[quals.length - 1] ?? added, "BDS");
    await user.type(screen.getByLabelText("Email to invite (optional)"), "meera.joshi@example.com");
    await continueTo(user, "Services and fees");
    const owner = client(backend, PEOPLE.asha);
    const meera = value(await owner.listPractitioners()).items.find((d) => d.display_name === "Dr Meera Joshi");
    expect(meera).toMatchObject({ qualifications: "BDS" });
    expect(JSON.stringify(value(await owner.listStaff()))).toContain("meera.joshi@example.com");
    // Back on the step, she can be removed; the owner's own row has no Remove.
    await user.click(screen.getByRole("button", { name: /Hours and doctors/ }));
    await screen.findByDisplayValue("Dr Meera Joshi");
    const you = screen.getAllByRole("listitem").find((li) => li.textContent.startsWith("You"));
    if (you === undefined) throw new Error("expected the owner's row");
    expect(within(you).queryByRole("button", { name: "Remove" })).toBeNull();
    await user.click(within(doctorRow("Dr Meera Joshi")).getByRole("button", { name: "Remove" }));
    await waitFor(() => {
      expect(screen.queryByDisplayValue("Dr Meera Joshi")).toBeNull();
    });
    expect(value(await owner.listPractitioners()).items.some((d) => d.display_name === "Dr Meera Joshi")).toBe(false);
  });

  it("step 2 refuses to remove a doctor who has appointments, and offers to deactivate", async () => {
    const { user, backend } = await wizard("/setup?step=hours");
    const owner = client(backend, PEOPLE.asha);
    const doctors = value(await owner.listPractitioners()).items;
    const booked = doctors.find((d) => d.membership_id !== null && d.display_name.includes("Dev"));
    if (booked === undefined) throw new Error("expected Dev");
    await screen.findByRole("heading", { name: "Hours and doctors" });
    await screen.findAllByRole("listitem");
    await user.click(within(doctorRow(booked.display_name)).getByRole("button", { name: "Remove" }));
    const alert = await screen.findByText(/has appointments, so can.t be removed/);
    expect(alert).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Deactivate instead" }));
    await waitFor(() => {
      expect(screen.queryByText(/has appointments/)).toBeNull();
    });
    const after = value(await owner.listPractitioners()).items.find((d) => d.id === booked.id);
    expect(after?.active).toBe(false);
  });
});

describe("Invited doctor's setup", () => {
  it("is one screen: name, qualifications, registration number and hours, and then Today", async () => {
    const user = userEvent.setup();
    const backend = fakeApi(freshClinic);
    window.sessionStorage.setItem(CLINIC_STORAGE_KEY, "sunrise");
    renderPortal("/today", { as: PEOPLE.dev, backend });
    await screen.findByRole("heading", { name: /Welcome to Sunrise Dental/ });
    expect(input(await screen.findByLabelText("Your name"))).toBe("Dr Dev Rao");
    await user.type(screen.getByLabelText("Qualifications"), "BDS");
    await user.type(screen.getByLabelText("Registration number"), "MH-777");
    await user.click(screen.getByRole("checkbox", { name: "Saturday" }));
    await user.click(screen.getByRole("button", { name: "Save and continue" }));
    await screen.findByRole("heading", { name: /Good (morning|afternoon|evening)/ }).catch(() => undefined);
    const dev = client(backend, PEOPLE.dev);
    expect(value(await dev.getMyPractitioner())).toMatchObject({
      qualifications: "BDS",
      registration_number: "MH-777",
    });
    expect(value(await dev.getMyWorkingHours()).shifts.some((s) => s.weekday === 6)).toBe(false);
    expect(value(await dev.getMySetup()).standing).toBe("complete");
  });

  it("can be skipped, and does not touch the clinic's own setup", async () => {
    const user = userEvent.setup();
    const backend = fakeApi(freshClinic);
    window.sessionStorage.setItem(CLINIC_STORAGE_KEY, "sunrise");
    renderPortal("/setup", { as: PEOPLE.dev, backend });
    await screen.findByRole("heading", { name: /Welcome to Sunrise Dental/ });
    await user.click(screen.getByRole("button", { name: "Skip for now" }));
    await waitFor(() => {
      expect(screen.queryByRole("heading", { name: /Welcome/ })).toBeNull();
    });
    expect(value(await client(backend, PEOPLE.dev).getMySetup()).steps[0]).toEqual({ key: "profile", status: "skipped" });
    expect(value(await client(backend, PEOPLE.asha).getSetup()).standing).toBe("new");
  });

  it("front-desk staff have nothing to set up", async () => {
    renderPortal("/setup", { as: PEOPLE.farah, backend: fakeApi(freshClinic) });
    await waitFor(() => {
      expect(screen.queryByRole("heading", { name: /Welcome|Set up/ })).toBeNull();
    });
    await screen.findByRole("heading", { name: /Good (morning|afternoon|evening)|Today/ }).catch(() => undefined);
  });
});

describe("step 5, the clinic's Today layout", () => {
    const AXE = { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } };

    it("Continue PUTs the clinic's layout and the theme is already saved, then marks the step done", async () => {
      const saved: DashboardLayout[] = [];
      const { user, backend } = await wizard("/setup?step=look", (client) => ({
        ...client,
        saveDashboardLayout: (layout, options) => {
          saved.push(layout);
          return client.saveDashboardLayout(layout, options);
        },
      }));
      await screen.findByRole("group", { name: "Live preview of Today" });
      await user.click(screen.getByRole("button", { name: /Executive/ }));
      await user.click(screen.getByRole("button", { name: "Compact" }));
      await user.click(screen.getByRole("button", { name: "Remove Busy hours" }));
      expect(saved).toHaveLength(0);
      await user.click(screen.getByRole("button", { name: "Continue" }));
      await waitFor(() => { expect(saved).toHaveLength(1); });
      expect(saved[0]?.tpl).toBe("executive");
      expect(saved[0]?.density).toBe("compact");
      expect(saved[0]?.items.some((item) => item.key === "busy_hours")).toBe(false);
      const api = client(backend, PEOPLE.asha);
      const clinic = value(await api.getDashboardLayout());
      expect(clinic.source).toBe("clinic");
      expect(clinic.layout).toEqual(saved[0]);
      await waitFor(async () => {
        expect(value(await api.getSetup()).steps.find((s) => s.key === "look")?.status).toBe("done");
      });
    });

    it("keeps the choices through a reload until Continue", async () => {
      const { user, backend } = await wizard("/setup?step=look");
      await screen.findByRole("group", { name: "Live preview of Today" });
      await user.click(screen.getByRole("button", { name: /Executive/ }));
      await user.click(screen.getByRole("button", { name: "Remove Busy hours" }));
      cleanup();
      renderPortal("/setup?step=look", { as: PEOPLE.asha, backend });
      await screen.findByRole("group", { name: "Live preview of Today" }, { timeout: 5000 });
      expect(screen.getByRole("button", { name: /Executive/ }).getAttribute("aria-pressed")).toBe("true");
      expect(screen.queryByRole("button", { name: "Remove Busy hours" })).toBeNull();
      // Nothing was saved to the clinic before Continue.
      expect(value(await client(backend, PEOPLE.asha).getDashboardLayout()).source).not.toBe("clinic");
    });

    it("has no accessibility violations", async () => {
      await wizard("/setup?step=look");
      await screen.findByRole("group", { name: "Live preview of Today" });
      const result = await axe.run(document.body, AXE);
      expect(result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
    });

    it("Skip still works and leaves the clinic's layout alone", async () => {
      const { user, backend } = await wizard("/setup?step=look");
      await screen.findByRole("group", { name: "Live preview of Today" });
      await user.click(screen.getByRole("button", { name: /Executive/ }));
      await user.click(screen.getByRole("button", { name: "Skip this step" }));
      await waitFor(async () => {
        expect(value(await client(backend, PEOPLE.asha).getSetup()).steps.find((s) => s.key === "look")?.status).toBe("skipped");
      });
      expect(value(await client(backend, PEOPLE.asha).getDashboardLayout()).source).not.toBe("clinic");
    });

    it("the owner's Today (New look) draws that layout once setup is finished", async () => {
      localStorage.setItem(NEW_LOOK_KEY, "1");
      const { user } = await wizard("/setup?step=look");
      await screen.findByRole("group", { name: "Live preview of Today" });
      await user.click(screen.getByRole("button", { name: /Executive/ }));
      await user.click(screen.getByRole("button", { name: "Compact" }));
      await user.click(screen.getByRole("button", { name: "Continue" }));
      // The other four steps are still open: wait for each one to show before skipping it.
      for (let step = 1; step <= 4; step += 1) {
        await screen.findByText(new RegExp(`Step ${String(step)} of 5`), {}, { timeout: 10_000 });
        await user.click(await screen.findByRole("button", { name: "Skip this step" }, { timeout: 5000 }));
      }
      await screen.findByRole("list", { name: "Key numbers" }, { timeout: 20_000 });
      const board = [...document.querySelectorAll<HTMLElement>(".tv2")].find((el) => el.closest(".tv2-preview") === null);
      expect(board?.getAttribute("data-tpl")).toBe("executive");
      expect(board?.getAttribute("data-density")).toBe("compact");
    }, 40_000);
  });
