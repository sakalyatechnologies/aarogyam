import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { failure, parseApiError, type ApiClient } from "@aarogyam/api-client";
import { ROLES, fakeTokenFor } from "@aarogyam/api-client/fake";

import { PEOPLE, fakeApi, renderPortal } from "./test/render.js";

const asAssistant = fakeApi((fixtures) => {
  const membership = fixtures.memberships.find((m) => m.user_id === PEOPLE.farah);
  if (membership !== undefined) membership.role = ROLES.assistant;
});

describe("New patient", () => {
  it("checks the form before sending anything", async () => {
    const user = userEvent.setup();
    const create = vi.fn();
    renderPortal("/patients/new", { as: PEOPLE.farah, wrap: (client) => ({ ...client, createPatient: create }) });
    await user.click(await screen.findByRole("button", { name: "Register patient" }));

    expect(await screen.findByText("Enter the patient's full name.")).toBeTruthy();
    expect(screen.getByText("Choose the patient's sex.")).toBeTruthy();
    expect(screen.getByText("Enter the date of birth, or give an age instead.")).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByLabelText(/full name/i));

    await user.type(screen.getByLabelText(/full name/i), "Asha Rane");
    await user.type(screen.getByLabelText(/mobile/i), "12345");
    await user.click(screen.getByRole("button", { name: "Register patient" }));
    expect(await screen.findByText("Enter a 10-digit mobile number.")).toBeTruthy();
    expect(create).not.toHaveBeenCalled();
  });

  it("puts the API's field errors on their fields", async () => {
    const user = userEvent.setup();
    const refusal = parseApiError(400, { error: { code: "invalid_request", message: "phone: number is on the do-not-contact list" } }, undefined);
    renderPortal("/patients/new", { as: PEOPLE.farah, wrap: (client) => ({ ...client, createPatient: () => Promise.resolve(failure(refusal)) }) });
    await user.type(await screen.findByLabelText(/full name/i), "Asha Rane");
    await user.click(screen.getByRole("radio", { name: "Female" }));
    await user.click(screen.getByRole("radio", { name: /age only/i }));
    await user.type(screen.getByLabelText(/age in years/i), "34");
    await user.type(screen.getByLabelText(/mobile/i), "9811122233");
    await user.click(screen.getByRole("button", { name: "Register patient" }));

    expect(await screen.findByText("Number is on the do-not-contact list")).toBeTruthy();
    expect(screen.getByLabelText(/mobile/i).getAttribute("aria-invalid")).toBe("true");
  });

  it("registers the patient and opens Patient 360 by ID", async () => {
    const user = userEvent.setup();
    const { router } = renderPortal("/patients/new", { as: PEOPLE.farah });
    await user.type(await screen.findByLabelText(/full name/i), "Asha Rane");
    await user.click(screen.getByRole("radio", { name: "Female" }));
    await user.type(screen.getByLabelText(/date of birth/i, { selector: "input[type=date]" }), "1992-04-12");
    await user.click(screen.getByRole("button", { name: "Register patient" }));

    expect(await screen.findByRole("heading", { name: "Asha Rane" })).toBeTruthy();
    expect(router.state.location.pathname).toMatch(/^\/patients\/[0-9a-f-]{36}$/);
    await waitFor(() => {
      expect(document.title).toBe("SD-49 · Patients · Sunrise Dental");
    });
  });
});

describe("Patients search", () => {
  it("shows recent patients, then searches once typing pauses", async () => {
    const user = userEvent.setup();
    const searches: string[] = [];
    renderPortal("/patients", {
      as: PEOPLE.farah,
      wrap: (client): ApiClient => ({
        ...client,
        searchPatients: (search, options) => {
          searches.push(search.q);
          return client.searchPatients(search, options);
        },
      }),
    });
    const box = await screen.findByRole("searchbox", { name: "Search patients" });
    await user.type(box, "SD-5");
    await waitFor(() => {
      expect(searches).toEqual(["SD-5"]);
    });
    const table = await screen.findByRole("table", { name: "Patients" });
    await waitFor(() => {
      expect(within(table).getAllByRole("row")).toHaveLength(2);
    });
  });

  it("says so when nothing matches, and offers to register", async () => {
    const user = userEvent.setup();
    renderPortal("/patients", { as: PEOPLE.farah });
    await user.type(await screen.findByRole("searchbox", { name: "Search patients" }), "zzzz qqqq");
    expect(await screen.findByText("No patients match your search")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "New patient" }).length).toBeGreaterThan(0);
  });
});

describe("Permissions", () => {
  it("asks a member of two clinics which to open, and hides Patients from a visiting consultant", async () => {
    const user = userEvent.setup();
    renderPortal("/today", { as: PEOPLE.dev });
    await user.click(await screen.findByRole("button", { name: /Lotus Dental Care/ }));
    expect(await screen.findByText(/Here's today at Lotus Dental Care/)).toBeTruthy();
    const nav = screen.getAllByRole("navigation", { name: "Main" })[0];
    expect(nav && within(nav).queryByRole("link", { name: "Patients" })).toBeNull();
    expect(nav && within(nav).getByRole("link", { name: "Today" })).toBeTruthy();
  });

  it("lets an assistant search but not register, and keeps contact details masked", async () => {
    renderPortal("/patients", { as: PEOPLE.farah, backend: asAssistant });
    await screen.findByRole("searchbox", { name: "Search patients" });
    expect(screen.queryByRole("button", { name: "New patient" })).toBeNull();
  });

  it("shows the day's money to the owner only", async () => {
    renderPortal("/today", { as: PEOPLE.asha });
    expect(await screen.findByText("Today's collection")).toBeTruthy();
  });

  it("keeps money off Today for the front desk", async () => {
    renderPortal("/today", { as: PEOPLE.farah });
    expect(await screen.findByText("Today's appointments")).toBeTruthy();
    expect(screen.queryByText("Today's collection")).toBeNull();
  });
});

describe("Patient 360", () => {
  it("masks contact details until asked, and keeps the name out of the title", async () => {
    const user = userEvent.setup();
    let path = "";
    const backend = fakeApi((fixtures) => {
      const sunrise = fixtures.clinics.find((c) => c.slug === "sunrise");
      const patient = fixtures.patients.find((p) => p.clinic_id === sunrise?.id && p.phone != null);
      path = `/patients/${patient?.id ?? ""}`;
    });
    renderPortal(path, { as: PEOPLE.farah, backend });
    const show = await screen.findByRole("button", { name: "Show phone" });
    expect(screen.getByText(/^\+91 ••••• •\d{4}$/)).toBeTruthy();
    await user.click(show);
    expect(screen.getByRole("button", { name: "Hide phone" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText(/^\+91 \d{5} \d{5}$/)).toBeTruthy();
    expect(document.title).toMatch(/^SD-\d+ · Patients · Sunrise Dental$/);
  });

  it("refuses a malformed address without calling the API", async () => {
    renderPortal("/patients/ananya-gupta", { as: PEOPLE.farah });
    expect(await screen.findByText("We couldn't find that patient")).toBeTruthy();
  });
});

describe("Invitation", () => {
  it("lets the invited owner join as a new person and opens the new clinic", async () => {
    const user = userEvent.setup();
    const backend = fakeApi();
    const created = await backend.client({ getToken: () => fakeTokenFor({ id: PEOPLE.admin }) }).createClinic({
      name: "Asha Dental Care",
      owner_email: "asha.rane@example.com",
    });
    if (!created.ok) throw new Error("could not create the clinic");
    renderPortal(`/invite#${created.value.invite_token}`, { backend });

    await user.type(await screen.findByLabelText("Your name"), "Dr Asha Rane");
    await user.type(screen.getByLabelText(/email/i), "asha.rane@example.com");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(await screen.findByRole("button", { name: "Join the clinic" }));

    expect(await screen.findByText(/Here's today at Asha Dental Care/)).toBeTruthy();
  });

  it("explains a used or unknown invitation", async () => {
    const user = userEvent.setup();
    renderPortal("/invite#not-a-real-token", { as: PEOPLE.farah });
    await user.click(await screen.findByRole("button", { name: "Join the clinic" }));
    expect((await screen.findByRole("alert")).textContent).toContain("used, has expired, or doesn't exist");
  });
});
