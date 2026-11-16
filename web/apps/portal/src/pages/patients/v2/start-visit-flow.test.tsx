import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { failure, type ApiClient } from "@aarogyam/api-client";
import type { Fixtures } from "@aarogyam/api-client/fake";

import { NEW_LOOK_KEY } from "../../../lib/new-look.js";
import { PEOPLE, fakeApi, renderPortal } from "../../../test/render.js";

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(NEW_LOOK_KEY, "1");
});
afterEach(() => {
  cleanup();
  localStorage.clear();
});

/** Generous: the patient page loads lazily and the suite often runs on a busy machine. */
const WAIT = { timeout: 20_000 };

/** Sunrise's day reduced to the given statuses, earliest first; every other appointment is cancelled. */
function sunriseDay(fixtures: Fixtures, statuses: readonly Fixtures["appointments"][number]["status"][]) {
  const sunrise = fixtures.clinics.find((c) => c.slug === "sunrise");
  const mine = fixtures.appointments.filter((a) => a.clinic_id === sunrise?.id).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  mine.forEach((appointment, index) => {
    const status = statuses[index];
    appointment.status = status ?? "cancelled";
    appointment.cancel_reason = status === undefined ? "Test" : null;
    appointment.arrived_at = status === "arrived" || status === "in_chair" ? appointment.starts_at : null;
    appointment.seated_at = status === "in_chair" ? appointment.starts_at : null;
    appointment.completed_at = null;
  });
  const first = mine[0];
  const patient = fixtures.patients.find((p) => p.id === first?.patient_id);
  return { id: patient?.id ?? "", name: patient?.full_name ?? "" };
}

/** Counts the calls that start a visit and what each visit was linked to, so a test can say how many went out and by which route. */
function countStarts() {
  const calls = { fromQueue: 0, plain: 0, linked: new Array<string | null | undefined>() };
  const wrap = (client: ApiClient): ApiClient => ({
    ...client,
    startVisitFromQueue: async (...args) => {
      calls.fromQueue += 1;
      const result = await client.startVisitFromQueue(...args);
      if (result.ok) calls.linked.push(result.value.visit.appointment_id);
      return result;
    },
    startVisit: async (...args) => {
      calls.plain += 1;
      const result = await client.startVisit(...args);
      if (result.ok) calls.linked.push(result.value.appointment_id);
      return result;
    },
  });
  return { calls, wrap };
}

describe("Starting a visit from Home (new look)", () => {
  it("Check in, then Start opens one visit and goes to the patient's page, which shows it in progress", async () => {
    const user = userEvent.setup();
    let who = { id: "", name: "" };
    const backend = fakeApi((fixtures) => {
      who = sunriseDay(fixtures, ["confirmed"]);
    });
    const { calls, wrap } = countStarts();
    const { router } = renderPortal("/today", { as: PEOPLE.asha, backend, wrap });
    const hero = await screen.findByRole("region", { name: "Next up" });
    await user.click(within(hero).getByRole("button", { name: "Check in" }));
    await user.click(await within(await screen.findByRole("region", { name: "Next up" })).findByRole("button", { name: "Start" }));

    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`/patients/${who.id}`);
    }, WAIT);
    await screen.findByRole("heading", { level: 1, name: who.name }, WAIT);
    // The visit is open: the bar says so and offers to end it, and there is no appointment "Complete visit" or second Start.
    await screen.findByText("Visit in progress", undefined, WAIT);
    expect(screen.getByRole("button", { name: "End visit" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Complete visit" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Start visit" })).toBeNull();
    expect([calls.fromQueue, calls.plain]).toEqual([1, 0]);
  });

  it("opens the patient's page from a row of the appointments table and from the queue", async () => {
    const user = userEvent.setup();
    let who = { id: "", name: "" };
    const backend = fakeApi((fixtures) => {
      who = sunriseDay(fixtures, ["arrived"]);
    });
    const { router } = renderPortal("/today", { as: PEOPLE.asha, backend });
    const table = await screen.findByRole("table", { name: "Appointments" });
    await user.click(within(table).getByRole("button", { name: new RegExp(who.name) }));
    await screen.findByRole("heading", { level: 1, name: who.name }, WAIT);
    expect(router.state.location.pathname).toBe(`/patients/${who.id}`);

    await router.navigate("/today");
    const queue = await screen.findByRole("list", { name: "Patient queue" });
    await user.click(within(queue).getByRole("button", { name: new RegExp(who.name) }));
    await screen.findByRole("heading", { level: 1, name: who.name }, WAIT);
    expect(router.state.location.pathname).toBe(`/patients/${who.id}`);
  });

  it("shows one Start per patient: the header adds Start next visit only when the Next up card leads with someone else", async () => {
    const backend = fakeApi((fixtures) => {
      sunriseDay(fixtures, ["arrived"]);
    });
    renderPortal("/today", { as: PEOPLE.asha, backend });
    const hero = await screen.findByRole("region", { name: "Next up" });
    await within(hero).findByRole("button", { name: "Start" }, WAIT);
    expect(screen.queryByRole("button", { name: "Start next visit" })).toBeNull();
    cleanup();

    const busy = fakeApi((fixtures) => {
      sunriseDay(fixtures, ["in_chair", "arrived"]);
    });
    renderPortal("/today", { as: PEOPLE.asha, backend: busy });
    expect(await screen.findByRole("button", { name: "Start next visit" }, WAIT)).toBeTruthy();
  });

  it("tells the desk on Home to collect once the doctor sends the patient to be billed, not 'With the doctor'", async () => {
    let name = "";
    const backend = fakeApi((fixtures) => {
      ({ name } = sunriseDay(fixtures, ["in_chair"]));
      const sunrise = fixtures.clinics.find((c) => c.slug === "sunrise");
      const first = fixtures.appointments.filter((a) => a.clinic_id === sunrise?.id).sort((a, b) => a.starts_at.localeCompare(b.starts_at))[0];
      const token = fixtures.queueTokens.find((t) => t.appointment_id === first?.id) ?? fixtures.queueTokens.find((t) => t.clinic_id === sunrise?.id);
      if (token === undefined || first === undefined) throw new Error("expected a Sunrise token");
      Object.assign(token, { appointment_id: first.id, patient_id: first.patient_id, status: "ready_to_bill" });
    });
    renderPortal("/today", { as: PEOPLE.farah, backend });
    const hero = await screen.findByRole("region", { name: "Next up" }, WAIT);
    await within(hero).findByText(name, undefined, WAIT);
    expect(await within(hero).findByRole("button", { name: /Collect payment/ }, WAIT)).toBeTruthy();
    expect(within(hero).queryByText("With the doctor")).toBeNull();
  });

  it("Open visit on the queue board goes to the patient's page with the visit in progress", async () => {
    const user = userEvent.setup();
    let who = { id: "", name: "" };
    const backend = fakeApi((fixtures) => {
      // A patient seated from the queue: their token is in the chair.
      const token = fixtures.queueTokens.find((t) => t.clinic_id === fixtures.clinics.find((c) => c.slug === "sunrise")?.id);
      if (token === undefined) throw new Error("expected a Sunrise queue token");
      token.status = "in_chair";
      const patient = fixtures.patients.find((p) => p.id === token.patient_id);
      who = { id: patient?.id ?? "", name: patient?.full_name ?? "" };
    });
    const { router } = renderPortal("/queue", { as: PEOPLE.asha, backend });
    const card = await screen.findByRole("listitem", { name: new RegExp(`, ${who.name}$`) }, WAIT);
    await user.click(within(card).getByRole("button", { name: "Open visit" }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`/patients/${who.id}`);
    }, WAIT);
    await screen.findByText("Visit in progress", undefined, WAIT);
  });

  it("Start on a patient already in the chair with no visit opens it, and not twice", async () => {
    const user = userEvent.setup();
    let who = { id: "", name: "" };
    const backend = fakeApi((fixtures) => {
      who = sunriseDay(fixtures, ["in_chair"]);
    });
    const { calls, wrap } = countStarts();
    renderPortal(`/patients/${who.id}`, { as: PEOPLE.asha, backend, wrap });
    const bar = await screen.findByRole("region", { name: "Visit actions" });
    await user.click(await within(bar).findByRole("button", { name: "Start visit" }));
    await within(bar).findByText("Visit in progress", undefined, WAIT);
    expect(within(bar).queryByRole("button", { name: "Start visit" })).toBeNull();
    expect(calls.fromQueue + calls.plain).toBe(1);
    // The visit is linked to the appointment (through its token or directly), so finishing it can close the appointment.
    expect(calls.linked).toHaveLength(1);
    expect(calls.linked[0]).toBeTruthy();
  });

  it("stops with an error, and starts nothing, when the visits or the queue cannot be read", async () => {
    for (const broken of ["listVisits", "listQueue"] as const) {
      const user = userEvent.setup();
      let who = { id: "", name: "" };
      const backend = fakeApi((fixtures) => {
        who = sunriseDay(fixtures, ["arrived"]);
      });
      const { calls, wrap } = countStarts();
      renderPortal("/today", {
        as: PEOPLE.asha,
        backend,
        wrap: (client) => ({ ...wrap(client), [broken]: () => Promise.resolve(failure({ status: 500, code: "internal", message: "Server error" })) }),
      });
      const hero = await screen.findByRole("region", { name: "Next up" }, WAIT);
      await user.click(await within(hero).findByRole("button", { name: "Start" }));
      expect((await screen.findByRole("alert", undefined, WAIT)).textContent).toContain("Server error");
      expect(calls.fromQueue + calls.plain).toBe(0);
      expect(who.id).not.toBe("");
      cleanup();
    }
  });

  it("does not reuse an open visit from another day: it says to finish it first and opens the patient", async () => {
    const user = userEvent.setup();
    let who = { id: "", name: "" };
    const backend = fakeApi((fixtures) => {
      who = sunriseDay(fixtures, ["arrived"]);
      const seeded = fixtures.visits[0];
      if (seeded !== undefined) {
        const old = new Date(Date.parse("2026-10-03T05:30:00Z") - 2 * 86_400_000).toISOString();
        fixtures.visits.push({ ...seeded, id: "0192e3c4-0000-7000-8000-00000000f002", patient_id: who.id, clinic_id: seeded.clinic_id, appointment_id: null, queue_token_id: null, status: "open", started_at: old, ended_at: null });
      }
    });
    const { calls, wrap } = countStarts();
    const { router } = renderPortal("/today", { as: PEOPLE.asha, backend, wrap });
    const hero = await screen.findByRole("region", { name: "Next up" }, WAIT);
    await user.click(await within(hero).findByRole("button", { name: "Start" }));
    expect((await screen.findByRole("alert", undefined, WAIT)).textContent).toMatch(/open visit from .*Finish it first/);
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`/patients/${who.id}`);
    }, WAIT);
    expect(calls.fromQueue + calls.plain).toBe(0);
  });
});

describe("The patient page shows one next step per state (new look)", () => {
  let router!: ReturnType<typeof renderPortal>["router"];
  async function bar(path: string, backend: ReturnType<typeof fakeApi>) {
    router = renderPortal(path, { as: PEOPLE.asha, backend }).router;
    return screen.findByRole("region", { name: "Visit actions" });
  }

  it("booked: Check in, with nothing else competing in the header", async () => {
    let who = { id: "", name: "" };
    const backend = fakeApi((fixtures) => {
      who = sunriseDay(fixtures, ["confirmed"]);
    });
    const actions = await bar(`/patients/${who.id}`, backend);
    await within(actions).findByRole("button", { name: "Check in" }, );
    expect(within(actions).queryByRole("button", { name: "Start visit" })).toBeNull();
    const summary = screen.getByRole("region", { name: "Patient summary" });
    expect(within(summary).queryByRole("button", { name: "Check in" })).toBeNull();
    expect(within(summary).queryByRole("button", { name: "Complete visit" })).toBeNull();
    expect(within(summary).getByRole("button", { name: "More" })).toBeTruthy();
  });

  it("a visit already open elsewhere (the phone) shows in progress and never offers a second Start", async () => {
    let who = { id: "", name: "" };
    const backend = fakeApi((fixtures) => {
      who = sunriseDay(fixtures, ["arrived"]);
      const seeded = fixtures.visits[0];
      if (seeded !== undefined) {
        fixtures.visits.push({ ...seeded, id: "0192e3c4-0000-7000-8000-00000000f001", patient_id: who.id, clinic_id: seeded.clinic_id, appointment_id: null, queue_token_id: null, status: "open", ended_at: null });
      }
    });
    const actions = await bar(`/patients/${who.id}`, backend);
    await within(actions).findByText("Visit in progress", undefined, WAIT);
    expect(within(actions).getByRole("button", { name: "End visit" })).toBeTruthy();
    expect(within(actions).queryByRole("button", { name: "Start visit" })).toBeNull();
    await waitFor(() => {
      expect(within(actions).queryByRole("button", { name: "Check in" })).toBeNull();
    });
  });

  it("ending the visit leaves payment as the next step; no second visit is offered for the same appointment", async () => {
    const user = userEvent.setup();
    let who = { id: "", name: "" };
    const backend = fakeApi((fixtures) => {
      who = sunriseDay(fixtures, ["arrived"]);
    });
    const actions = await bar(`/patients/${who.id}`, backend);
    await user.click(await within(actions).findByRole("button", { name: "Start visit" }));
    await user.click(await within(actions).findByRole("button", { name: "End visit" }, ));
    await within(actions).findByRole("button", { name: "Collect payment" }, );
    expect(within(actions).queryByRole("button", { name: "Start visit" })).toBeNull();
    expect(within(actions).queryByRole("button", { name: "End visit" })).toBeNull();
    // Come back to the page later: it still knows the visit is finished and payment is next, and offers no second visit.
    await router.navigate("/today");
    await screen.findByRole("region", { name: "Next up" }, WAIT);
    await router.navigate(`/patients/${who.id}`);
    await screen.findByText("Visit finished, payment pending", undefined, WAIT);
    const again = screen.getByRole("region", { name: "Visit actions" });
    expect(within(again).getByRole("button", { name: "Collect payment" })).toBeTruthy();
    expect(within(again).queryByRole("button", { name: "Start visit" })).toBeNull();
  });

  it("front desk, who has no visit bar, still gets Check in and Seat in the header, and 'With the doctor' once seated", async () => {
    let who = { id: "", name: "" };
    const backend = fakeApi((fixtures) => {
      who = sunriseDay(fixtures, ["confirmed"]);
    });
    const { router: desk } = renderPortal(`/patients/${who.id}`, { as: PEOPLE.farah, backend });
    const summary = await screen.findByRole("region", { name: "Patient summary" }, WAIT);
    const user = userEvent.setup();
    await user.click(await within(summary).findByRole("button", { name: "Check in" }));
    await user.click(await within(summary).findByRole("button", { name: "Seat in chair" }));
    await within(summary).findByText("With the doctor", undefined, WAIT);
    expect(within(summary).queryByRole("button", { name: "Continue visit" })).toBeNull();
    expect(desk.state.location.pathname).toBe(`/patients/${who.id}`);
  });
});
