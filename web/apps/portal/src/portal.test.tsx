import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { failure, type ApiClient, type PatientQuery } from "@aarogyam/api-client";

import { USERS, renderPortal } from "./test/render.js";

describe("New patient", () => {
  it("checks the form before sending anything", async () => {
    const user = userEvent.setup();
    const create = vi.fn();
    renderPortal("/patients/new", USERS.sunita, (client) => ({ ...client, createPatient: create }));
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
    renderPortal("/patients/new", USERS.sunita, (client) => ({
      ...client,
      createPatient: () =>
        Promise.resolve(failure({ status: 422, code: "validation_failed", message: "This number is on the clinic's do-not-contact list.", field: "phone" })),
    }));
    await user.type(await screen.findByLabelText(/full name/i), "Asha Rane");
    await user.click(screen.getByRole("radio", { name: "Female" }));
    await user.click(screen.getByRole("radio", { name: /age only/i }));
    await user.type(screen.getByLabelText(/age in years/i), "34");
    await user.type(screen.getByLabelText(/mobile/i), "9811122233");
    await user.click(screen.getByRole("button", { name: "Register patient" }));

    expect(await screen.findByText("This number is on the clinic's do-not-contact list.")).toBeTruthy();
    expect(screen.getByLabelText(/mobile/i).getAttribute("aria-invalid")).toBe("true");
  });

  it("registers the patient and opens Patient 360 by clinic number", async () => {
    const user = userEvent.setup();
    const router = renderPortal("/patients/new", USERS.sunita);
    await user.type(await screen.findByLabelText(/full name/i), "Asha Rane");
    await user.click(screen.getByRole("radio", { name: "Female" }));
    await user.type(screen.getByLabelText(/date of birth/i, { selector: "input[type=date]" }), "1992-04-12");
    await user.click(screen.getByRole("button", { name: "Register patient" }));

    expect(await screen.findByRole("heading", { name: "Asha Rane" })).toBeTruthy();
    expect(router.state.location.pathname).toBe("/patients/SC-1049");
    expect(document.title).toBe("SC-1049 · Patients · Smile Catchers");
  });
});

describe("Patients search", () => {
  it("waits for typing to pause before searching", async () => {
    const user = userEvent.setup();
    const queries: (string | undefined)[] = [];
    renderPortal("/patients", USERS.sunita, (client): ApiClient => ({
      ...client,
      listPatients: (query: PatientQuery, options) => {
        queries.push(query.q);
        return client.listPatients(query, options);
      },
    }));
    const box = await screen.findByRole("searchbox", { name: "Search patients" });
    await user.type(box, "SC-1005");
    await waitFor(() => {
      expect(queries).toContain("SC-1005");
    });
    expect(queries).toEqual(["", "SC-1005"]);
    const table = await screen.findByRole("table", { name: "Patients" });
    await waitFor(() => {
      expect(within(table).getAllByRole("row")).toHaveLength(2);
    });
  });

  it("says so when nothing matches, and offers to register", async () => {
    const user = userEvent.setup();
    renderPortal("/patients", USERS.sunita);
    await user.type(await screen.findByRole("searchbox", { name: "Search patients" }), "zzzz qqqq");
    expect(await screen.findByText("No patients match your search")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "New patient" }).length).toBeGreaterThan(0);
  });
});

describe("Permissions", () => {
  it("hides Patients from a visiting consultant", async () => {
    renderPortal("/today", USERS.vivek);
    expect(await screen.findByText(/Here's today at Smile Catchers/)).toBeTruthy();
    const nav = screen.getAllByRole("navigation", { name: "Main" })[0];
    expect(nav && within(nav).queryByRole("link", { name: "Patients" })).toBeNull();
    expect(nav && within(nav).getByRole("link", { name: "Today" })).toBeTruthy();
  });

  it("lets an assistant search but not register", async () => {
    renderPortal("/patients", USERS.ravi);
    await screen.findByRole("searchbox", { name: "Search patients" });
    expect(screen.queryByRole("button", { name: "New patient" })).toBeNull();
  });

  it("asks a member of two clinics which to open, and shows the day's money to the owner", async () => {
    const user = userEvent.setup();
    renderPortal("/today", USERS.anika);
    expect(await screen.findByRole("heading", { name: "Choose a clinic" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /Smile Catchers/ }));
    expect(await screen.findByText("Today's collection")).toBeTruthy();
    expect(screen.getByText("₹28,500")).toBeTruthy();
  });

  it("keeps money off Today for staff without finance.view", async () => {
    renderPortal("/today", USERS.sunita);
    expect(await screen.findByText("Today's appointments")).toBeTruthy();
    expect(screen.queryByText("Today's collection")).toBeNull();
  });
});

describe("Patient 360", () => {
  it("masks contact details until asked, and keeps the name out of the title", async () => {
    const user = userEvent.setup();
    renderPortal("/patients/SC-1001", USERS.sunita);
    const show = await screen.findByRole("button", { name: "Show phone" });
    expect(screen.getByText(/^\+91 ••••• •\d{4}$/)).toBeTruthy();
    await user.click(show);
    expect(screen.getByRole("button", { name: "Hide phone" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText(/^\+91 \d{5} \d{5}$/)).toBeTruthy();
    expect(document.title).toBe("SC-1001 · Patients · Smile Catchers");
  });

  it("refuses a malformed number without calling the API", async () => {
    renderPortal("/patients/rahul-patil", USERS.sunita);
    expect(await screen.findByText("We couldn't find that patient")).toBeTruthy();
  });
});
