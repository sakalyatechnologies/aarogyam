import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { describe, expect, it } from "vitest";

import { fakeTokenFor } from "@aarogyam/api-client/fake";

import { NOW, PEOPLE, fakeApi, renderPortal } from "../../test/render.js";
import { EMPTY_INTAKE, toIntake, toggleHealth } from "../../components/intake/intake-model.js";

const SUNRISE = "sunrise.localtest.me";

const desk = (backend: ReturnType<typeof fakeApi>) => backend.client({ host: SUNRISE, getToken: () => fakeTokenFor({ id: PEOPLE.farah }), now: () => NOW });

async function fillBasics(user: ReturnType<typeof userEvent.setup>, sex: "Female" | "Male") {
  await user.type(await screen.findByLabelText(/full name/i), "Meera Joshi");
  await user.click(screen.getByLabelText(sex));
  await user.click(screen.getByLabelText(/Age only/));
  await user.type(await screen.findByLabelText(/^Age in years/), "30");
}

describe("registration case-paper model", () => {
  it("'none' clears the other ticks and any other tick clears 'none'", () => {
    const some = toggleHealth(toggleHealth(EMPTY_INTAKE, "asthma"), "diabetes");
    expect(some.health).toEqual(["asthma", "diabetes"]);
    const none = toggleHealth(some, "none");
    expect(none.health).toEqual(["none"]);
    expect(toggleHealth(none, "asthma").health).toEqual(["asthma"]);
  });

  it("ticking pregnant or nursing ticks the checklist, and the women's fields go only for a female patient", () => {
    const ticked = toggleHealth(EMPTY_INTAKE, "pregnant");
    expect(ticked.pregnant).toBe(true);
    const values = { ...ticked, dueDate: "2027-03-01", occupation: "Teacher" };
    expect(toIntake(values, true)).toMatchObject({ pregnant: true, due_date: "2027-03-01", occupation: "Teacher" });
    expect(toIntake(values, false)).toEqual({ occupation: "Teacher" });
  });
});

describe("New patient: case-paper sections", () => {
  it("renders the sections, keeps 'none' exclusive and shows 'For women' only for a female patient", async () => {
    const user = userEvent.setup();
    renderPortal("/patients/new", { as: PEOPLE.farah });
    await fillBasics(user, "Male");
    for (const name of ["Personal details", "Contact", "How they found us", "Medical history"]) {
      expect(await screen.findByText(name)).toBeTruthy();
    }
    expect(screen.queryByText("For women")).toBeNull();
    await user.click(screen.getByLabelText("Female"));
    expect(await screen.findByText("For women")).toBeTruthy();

    await user.click(screen.getByText("Medical history"));
    const [first, second] = ["Asthma", "Diabetes"].map((name) => screen.getByRole("button", { name }));
    if (first === undefined || second === undefined) throw new Error("expected checklist chips");
    await user.click(first);
    await user.click(second);
    expect(first.getAttribute("aria-pressed")).toBe("true");
    await user.click(screen.getByRole("button", { name: /none of these/i }));
    expect(first.getAttribute("aria-pressed")).toBe("false");
    expect(second.getAttribute("aria-pressed")).toBe("false");
    await user.click(first);
    expect(screen.getByRole("button", { name: /none of these/i }).getAttribute("aria-pressed")).toBe("false");

    const result = await axe.run(document.body, { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } });
    expect(result.violations.map((violation) => violation.id)).toEqual([]);
  });

  it("sends the intake, the checklist and the allergies on create", async () => {
    const user = userEvent.setup();
    const backend = fakeApi();
    renderPortal("/patients/new", { as: PEOPLE.farah, backend });
    await fillBasics(user, "Female");
    await user.click(await screen.findByText("Personal details"));
    await user.type(screen.getByLabelText("Occupation"), "Teacher");
    await user.click(screen.getByText("Contact"));
    await user.type(screen.getByLabelText("Mobile"), "9876543210");
    await user.click(screen.getByLabelText("Same as mobile"));
    await user.click(screen.getByText("Medical history"));
    await user.type(screen.getByLabelText("Drug allergies"), "Penicillin");
    await user.click(screen.getByText("For women"));
    await user.click(screen.getByLabelText("Pregnant"));
    await user.click(screen.getByRole("button", { name: "Register patient" }));
    await screen.findByText(/^Registered/);

    const list = await desk(backend).listPatients();
    if (!list.ok) throw new Error("expected patients");
    const made = list.value.items.find((p) => p.full_name === "Meera Joshi");
    if (made === undefined) throw new Error("expected the patient");
    const saved = await desk(backend).patientIntake(made.id);
    if (!saved.ok) throw new Error("expected the intake");
    expect(saved.value).toMatchObject({ occupation: "Teacher", alt_phone: "+919876543210", pregnant: true });
  });

  it("offers Open profile, Book and Add family member for a number already registered", async () => {
    const user = userEvent.setup();
    const backend = fakeApi();
    const made = await desk(backend).createPatient({ full_name: "Ravi Joshi", sex: "male", age_years: 40, phone: "+919876543210" });
    if (!made.ok) throw new Error("expected the patient");
    renderPortal("/patients/new", { as: PEOPLE.farah, backend });
    await user.type(await screen.findByLabelText("Mobile"), "9876543210");
    const card = await screen.findByRole("region", { name: "Already registered on this number" }, { timeout: 8000 });
    expect(card.textContent).toContain("Ravi Joshi");
    expect(card.textContent).toContain(made.value.number);
    expect(screen.getByRole("link", { name: /^Open profile/ })).toBeTruthy();
    expect(screen.getByRole("link", { name: /^Book/ }).getAttribute("href")).toContain(`patient=${made.value.id}`);
    await user.click(screen.getByRole("button", { name: "Add family member on this number" }));
    expect(screen.getByLabelText("Relation to the person on this number")).toBeTruthy();

    await fillBasics(user, "Female");
    await user.click(screen.getByRole("button", { name: "Register patient" }));
    await screen.findByText(/^Registered/);
    await waitFor(async () => {
      const family = await desk(backend).listFamily(made.value.id);
      if (!family.ok) throw new Error("expected the family");
      expect(family.value.items).toHaveLength(1);
    });
  });
});
