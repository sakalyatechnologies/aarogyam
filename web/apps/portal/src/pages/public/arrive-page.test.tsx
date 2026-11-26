import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { fakeTokenFor } from "@aarogyam/api-client/fake";

import { NOW, PEOPLE, fakeApi, renderPortal } from "../../test/render.js";
import { arriveBody, arriveProblems, EMPTY_ARRIVE, parseAgeOrBirth } from "./arrive-form.js";

const SUNRISE = "sunrise.localtest.me";
const TODAY = "2026-10-03";

async function turnOn(backend: ReturnType<typeof fakeApi>): Promise<string> {
  const owner = backend.client({ host: SUNRISE, getToken: () => fakeTokenFor({ id: PEOPLE.asha }), now: () => NOW });
  const result = await owner.setSelfCheckIn(true);
  if (!result.ok) throw new Error("expected the QR to turn on");
  return new URL(result.value.url ?? "").searchParams.get("k") ?? "";
}

describe("QR check-in form rules", () => {
  it("needs a first name, a mobile number, a reason and the care consent", () => {
    const problems = arriveProblems(EMPTY_ARRIVE, TODAY);
    expect(Object.keys(problems).sort()).toEqual(["consentCare", "firstName", "phone", "reasons"]);
    const ok = { ...EMPTY_ARRIVE, firstName: "Asha", phone: "9876543210", reasonText: "Toothache", consentCare: true };
    expect(arriveProblems(ok, TODAY)).toEqual({});
  });

  it("asks for the contact and the relation when it is for someone else, and keeps the last name optional", () => {
    const base = { ...EMPTY_ARRIVE, firstName: "Mira", phone: "9876543210", reasons: ["tooth_pain"], consentCare: true, forSelf: false };
    expect(Object.keys(arriveProblems(base, TODAY)).sort()).toEqual(["contactName", "relation"]);
    expect(arriveProblems({ ...base, contactName: "Ravi", relation: "parent" }, TODAY)).toEqual({});
  });

  it("reads one field as an age or a date of birth", () => {
    expect(parseAgeOrBirth("34", TODAY)).toEqual({ kind: "age", years: 34 });
    expect(parseAgeOrBirth("12/05/1990", TODAY)).toEqual({ kind: "birth", date: "1990-05-12" });
    expect(parseAgeOrBirth("1990-5-2", TODAY)).toEqual({ kind: "birth", date: "1990-05-02" });
    expect(parseAgeOrBirth("", TODAY)).toEqual({ kind: "none" });
    for (const bad of ["200", "31/02/1990", "01/01/2030", "abc"]) expect(parseAgeOrBirth(bad, TODAY).kind).toBe("bad");
  });

  it("builds the request without a family link and with the PIN's place", () => {
    const body = arriveBody("k1", { ...EMPTY_ARRIVE, firstName: " Asha ", phone: "9876543210", reasons: ["checkup"], consentCare: true, ageOrBirth: "34", pin: { pincode: "411001", city: "Pune", state: "Maharashtra" } }, TODAY, "");
    expect(body).toMatchObject({ k: "k1", first_name: "Asha", for_self: true, age_years: 34, date_of_birth: null, consent_care: true, address: { pincode: "411001", city: "Pune", district: "Pune", state: "Maharashtra" } });
  });
});

describe("/arrive (public, no sign-in)", () => {
  it("sends a request and says to take a seat", async () => {
    const user = userEvent.setup();
    const backend = fakeApi();
    const key = await turnOn(backend);
    renderPortal(`/arrive?k=${key}&clinic=${SUNRISE}`, { backend });

    expect(await screen.findByRole("heading", { name: "Welcome to Sunrise Dental" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByText("Enter the first name.")).toBeTruthy();
    expect(screen.getByText("Please agree so the clinic can treat you.")).toBeTruthy();

    await user.type(screen.getByLabelText(/first name/i), "Asha");
    await user.type(screen.getByLabelText(/mobile number/i), "9876543210");
    await user.click(screen.getByRole("button", { name: "Tooth pain" }));
    await user.click(screen.getByRole("checkbox", { name: /i agree to sunrise dental/i }));
    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(await screen.findByText("Please take a seat")).toBeTruthy();
    const desk = backend.client({ host: SUNRISE, getToken: () => fakeTokenFor({ id: PEOPLE.farah }), now: () => NOW });
    const waiting = await desk.listArrivals();
    if (!waiting.ok) throw new Error("expected the list");
    expect(waiting.value.items).toHaveLength(1);
    expect(waiting.value.items[0]?.first_name).toBe("Asha");
  });

  it("fills city and state from the PIN code", async () => {
    const user = userEvent.setup();
    const backend = fakeApi();
    const key = await turnOn(backend);
    renderPortal(`/arrive?k=${key}&clinic=${SUNRISE}`, { backend });
    await user.click(await screen.findByText("A few more details (optional)"));
    await user.type(screen.getByLabelText("PIN code"), "411001");
    expect((await screen.findByTestId("pin-filled")).textContent).toContain("Pune, Maharashtra");
    await user.click(screen.getByRole("button", { name: "Change" }));
    expect(screen.getByLabelText("State")).toHaveProperty("value", "Maharashtra");
  });

  it("offers the case-paper sections, sends them, and never looks anyone up by phone", async () => {
    const user = userEvent.setup();
    const backend = fakeApi();
    const key = await turnOn(backend);
    const desk = backend.client({ host: SUNRISE, getToken: () => fakeTokenFor({ id: PEOPLE.farah }), now: () => NOW });
    await desk.createPatient({ full_name: "Ravi Joshi", sex: "male", age_years: 40, phone: "+919876543210" });
    renderPortal(`/arrive?k=${key}&clinic=${SUNRISE}`, { backend });

    await user.click(await screen.findByText("A few more details (optional)"));
    for (const name of ["Personal details", "Contact", "How they found us", "Medical history"]) expect(screen.getByText(name)).toBeTruthy();
    expect(screen.queryByText("For women")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Female" }));
    expect(await screen.findByText("For women")).toBeTruthy();

    await user.type(screen.getByLabelText(/first name/i), "Asha");
    await user.type(screen.getByLabelText(/mobile number/i), "9876543210");
    // A known number: nothing about who owns it is shown to the patient.
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(screen.queryByText(/already registered/i)).toBeNull();
    expect(document.body.textContent).not.toContain("Ravi");

    await user.click(screen.getByText("Personal details"));
    await user.type(screen.getByLabelText("Occupation"), "Teacher");
    await user.click(screen.getByRole("button", { name: "Tooth pain" }));
    await user.click(screen.getByRole("checkbox", { name: /i agree to sunrise dental/i }));
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByText("Please take a seat")).toBeTruthy();
    const waiting = await desk.listArrivals();
    if (!waiting.ok) throw new Error("expected the list");
    expect(waiting.value.items[0]?.intake).toMatchObject({ occupation: "Teacher" });
  });

  it("says the QR isn't active for a wrong key", async () => {
    renderPortal(`/arrive?k=wrong&clinic=${SUNRISE}`);
    expect(await screen.findByText("This QR code isn't active")).toBeTruthy();
  });
});
