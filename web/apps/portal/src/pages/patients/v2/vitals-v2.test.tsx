import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { fakeTokenFor } from "@aarogyam/api-client/fake";
import { observation, patientId as parsePatientId, type NewReadings, type Observation } from "@aarogyam/api-client";

import { NEW_LOOK_KEY } from "../../../lib/new-look.js";
import { NOW, PEOPLE, fakeApi, renderPortal } from "../../../test/render.js";
import { currentReadings, parseValue, vitalsOf } from "../../visits/vitals.js";

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(NEW_LOOK_KEY, "1");
});
afterEach(() => {
  cleanup();
  localStorage.clear();
});

function first<T>(items: readonly T[]): T {
  const [head] = items;
  if (head === undefined) throw new Error("expected at least one match");
  return head;
}

async function clickFirst(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(first(await screen.findAllByRole("button", { name }, { timeout: 5000 })));
}

/** The seeded patient with a closed visit that has a pulse of 76. */
function visited(readOnly = false) {
  let patient = "";
  const backend = fakeApi((fixtures) => {
    const membership = fixtures.memberships.find((m) => m.user_id === PEOPLE.farah);
    // A role that may read the record but not write it.
    if (readOnly && membership !== undefined) membership.role = { key: "reader", name: "Reader", permissions: ["patients.read", "appointments.read", "clinical.read"] };
    const sunrise = fixtures.clinics.find((c) => c.slug === "sunrise");
    patient = fixtures.visits.find((v) => v.clinic_id === sunrise?.id)?.patient_id ?? "";
  });
  return { backend, patientId: patient, path: `/patients/${patient}` };
}

const asha = (backend: ReturnType<typeof fakeApi>) => backend.client({ host: "sunrise.localtest.me", getToken: () => fakeTokenFor({ id: PEOPLE.asha }), now: () => NOW });

async function axeViolations(): Promise<string[]> {
  const result = await axe.run(document.body, { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } });
  return result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
}

describe("Vitals in a running visit", () => {
  it("records BP and pulse in one request and shows them as chips", async () => {
    const user = userEvent.setup();
    const { path, backend } = visited();
    const sent: NewReadings[] = [];
    renderPortal(path, {
      as: PEOPLE.asha,
      backend,
      wrap: (client) => ({
        ...client,
        recordObservations: (id, input, options) => {
          sent.push(input);
          return client.recordObservations(id, input, options);
        },
      }),
    });
    await clickFirst(user, "Start visit");
    expect(await screen.findByText("No vitals recorded")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Add vitals" }));
    await user.type(screen.getByLabelText("BP systolic (mmHg)"), "120");
    await user.type(screen.getByLabelText("BP diastolic (mmHg)"), "80");
    await user.type(screen.getByLabelText("Pulse (/min)"), "72");
    await user.click(screen.getByRole("button", { name: "Save vitals" }));
    const chips = await screen.findByRole("list", { name: "Vitals" });
    expect(within(chips).getByText("BP 120/80")).toBeTruthy();
    expect(within(chips).getByText("Pulse 72")).toBeTruthy();
    expect(sent).toHaveLength(1);
    expect(sent[0]?.readings).toEqual([
      { kind: "bp_systolic", value: 120 },
      { kind: "bp_diastolic", value: 80 },
      { kind: "pulse", value: 72 },
    ]);
    expect(screen.queryByRole("form", { name: "Add vitals" })).toBeNull();
  });

  it("shows the API's message when saving fails, and has no axe violations with the form open", async () => {
    const user = userEvent.setup();
    const { path, backend } = visited();
    renderPortal(path, {
      as: PEOPLE.asha,
      backend,
      wrap: (client) => ({
        ...client,
        recordObservations: () => Promise.resolve({ ok: false, error: { status: 422, code: "invalid", message: "Pulse is not plausible." } }),
      }),
    });
    await clickFirst(user, "Start visit");
    await user.click(await screen.findByRole("button", { name: "Add vitals" }));
    expect(await axeViolations()).toEqual([]);
    await user.type(screen.getByLabelText("Pulse (/min)"), "900");
    await user.click(screen.getByRole("button", { name: "Save vitals" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Pulse is not plausible.");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("form", { name: "Add vitals" })).toBeNull();
  });

  it("does not block End visit when no vitals were entered", async () => {
    const user = userEvent.setup();
    const { path, backend } = visited();
    renderPortal(path, { as: PEOPLE.asha, backend });
    await clickFirst(user, "Start visit");
    await screen.findByText("No vitals recorded");
    await user.click(screen.getByRole("button", { name: "End visit" }));
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "End visit" })).toBeNull();
    });
  });

  it("offers no Add vitals without clinical.write, but shows what is recorded", async () => {
    const { path, backend, patientId } = visited(true);
    const started = await asha(backend).startVisit(parsePatientId.parse(patientId), {});
    if (!started.ok) throw new Error("start failed");
    await asha(backend).recordObservations(started.value.id, { readings: [{ kind: "pulse", value: 70 }] });
    renderPortal(path, { as: PEOPLE.farah, backend });
    expect(await screen.findByText("Pulse 70")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add vitals" })).toBeNull();
  });
});

describe("Vitals on a closed visit", () => {
  it("shows the last vitals read-only on the summary and in the visit detail", async () => {
    const user = userEvent.setup();
    const { path, backend } = visited();
    renderPortal(path, { as: PEOPLE.asha, backend });
    expect(await screen.findByText("Last vitals")).toBeTruthy();
    expect(await screen.findByText("Pulse 76")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add vitals" })).toBeNull();
    await user.click(screen.getByRole("tab", { name: "History" }));
    const rows = await screen.findAllByRole("button", { name: /^Open visit / });
    await user.click(first(rows));
    const detail = await screen.findByRole("dialog", { name: /^Visit / });
    const section = await within(detail).findByRole("region", { name: "Vitals" });
    expect(within(section).getByText("Pulse 76")).toBeTruthy();
    expect(within(detail).queryByRole("button", { name: "Add vitals" })).toBeNull();
  });
});

describe("Reading vitals", () => {
  type Over = Partial<Omit<Observation, "id" | "supersedes_id">> & { id: string; supersedes_id?: string };
  const reading = (over: Over): Observation =>
    observation.parse({ kind: "pulse", value: 72, unit: "/min", status: "final", source: "clinician", recorded_at: "2026-10-03T05:30:00Z", ...over });

  it("pairs blood pressure, skips corrected and wrong readings, and parses typed numbers", () => {
    const rows = [
      reading({ id: "s", kind: "bp_systolic", value: 120, unit: "mmHg" }),
      reading({ id: "d", kind: "bp_diastolic", value: 80, unit: "mmHg" }),
      reading({ id: "p1", value: 70 }),
      reading({ id: "p2", value: 72, supersedes_id: "p1", status: "corrected" }),
      reading({ id: "t", kind: "temperature", value: 36.8, unit: "Cel", status: "entered_in_error" }),
    ];
    expect(currentReadings(rows).map((r) => r.id)).toEqual(["s", "d", "p2"]);
    expect(vitalsOf(rows).map((v) => v.text)).toEqual(["BP 120/80", "Pulse 72"]);
    expect(parseValue("98.6")).toBe(98.6);
    expect(parseValue(" ")).toBeUndefined();
    expect(parseValue("abc")).toBeUndefined();
  });
});
