import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { fakeTokenFor } from "@aarogyam/api-client/fake";

import { NOW, PEOPLE, fakeApi, renderPortal } from "../../test/render.js";

const SUNRISE = "sunrise.localtest.me";

function as(backend: ReturnType<typeof fakeApi>, who: string) {
  return backend.client({ host: SUNRISE, getToken: () => fakeTokenFor({ id: who }), now: () => NOW });
}

async function scan(backend: ReturnType<typeof fakeApi>, phone: string, firstName = "Asha") {
  const set = await as(backend, PEOPLE.asha).setSelfCheckIn(true);
  if (!set.ok) throw new Error("expected the QR on");
  const k = new URL(set.value.url ?? "").searchParams.get("k") ?? "";
  const sent = await backend.client({ host: SUNRISE, now: () => NOW }).sendArrival({ k, first_name: firstName, phone, reasons: ["tooth_pain"], consent_care: true, for_self: true });
  if (!sent.ok) throw new Error("expected the request to be sent");
}

describe("Front desk: waiting to check in", () => {
  it("shows nothing when nobody has scanned", async () => {
    renderPortal("/queue", { as: PEOPLE.farah });
    await screen.findByRole("heading", { name: "Queue" });
    expect(screen.queryByText(/waiting to check in/)).toBeNull();
  });

  it("accepts a request as a new patient, who gets a token", async () => {
    const user = userEvent.setup();
    const backend = fakeApi();
    await scan(backend, "9876500001");
    renderPortal("/queue", { as: PEOPLE.farah, backend });

    expect(await screen.findByText("1 waiting to check in")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Review" }));
    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).getByText("Asha")).toBeTruthy();
    await user.click(within(sheet).getByRole("button", { name: "Accept" }));

    await waitFor(() => { expect(screen.queryByText("1 waiting to check in")).toBeNull(); });
    const waiting = await as(backend, PEOPLE.farah).listArrivals();
    if (!waiting.ok) throw new Error("expected the list");
    expect(waiting.value.items).toHaveLength(0);
    const patients = await as(backend, PEOPLE.farah).listPatients();
    if (!patients.ok) throw new Error("expected patients");
    expect(patients.value.items.some((p) => p.full_name === "Asha")).toBe(true);
  });

  it("defaults the match list to New patient and shows the submitted name beside each match", async () => {
    const user = userEvent.setup();
    const backend = fakeApi();
    const patients = await as(backend, PEOPLE.farah).listPatients();
    if (!patients.ok) throw new Error("expected patients");
    const known = patients.value.items.find((p) => typeof p.phone === "string" && p.phone.startsWith("+91"));
    if (known === undefined || typeof known.phone !== "string") throw new Error("expected a patient with a phone");
    await scan(backend, known.phone.slice(3), "Visitor");
    renderPortal("/queue", { as: PEOPLE.farah, backend });

    await user.click(await screen.findByRole("button", { name: "Review" }));
    const sheet = await screen.findByRole("dialog");
    const radios = within(sheet).getAllByRole("radio");
    expect(radios.length).toBeGreaterThan(1);
    expect(radios[0]).toHaveProperty("checked", true);
    expect(within(sheet).getByText(new RegExp(`${known.full_name}.*submitted as Visitor`))).toBeTruthy();
  });

  it("dismisses a request, and refreshes when the request was already handled", async () => {
    const user = userEvent.setup();
    const backend = fakeApi();
    await scan(backend, "9876500002");
    renderPortal("/queue", { as: PEOPLE.farah, backend });

    await user.click(await screen.findByRole("button", { name: "Review" }));
    const sheet = await screen.findByRole("dialog");
    // Another desk handles it first.
    const waiting = await as(backend, PEOPLE.farah).listArrivals();
    if (!waiting.ok) throw new Error("expected the list");
    await as(backend, PEOPLE.farah).dismissArrival(waiting.value.items[0]?.id ?? "");
    await user.click(within(sheet).getByRole("button", { name: "Accept" }));

    expect((await screen.findAllByText("Someone at the desk already handled this one.")).length).toBeGreaterThan(0);
    await waitFor(() => { expect(screen.queryByText("1 waiting to check in")).toBeNull(); });
  });
});
