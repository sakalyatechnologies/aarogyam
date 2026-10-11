import { act, cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakeTokenFor } from "@aarogyam/api-client/fake";
import type { NewPayment } from "@aarogyam/api-client";

import { NEW_LOOK_KEY } from "../../../lib/new-look.js";
import { NOW, PEOPLE, fakeApi, renderPortal } from "../../../test/render.js";
import { FakeRecognition, installVoiceDoubles, removeVoiceDoubles } from "../../visits/voice/test-doubles.js";
import { elapsed } from "./visit-bar.js";
import { layoutKey, type P360Layout } from "./use-layout.js";
import { stamp } from "./use-voice-notes.js";
import { paiseOf } from "./visit-session.js";

type User = ReturnType<typeof userEvent.setup>;

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(NEW_LOOK_KEY, "1");
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  removeVoiceDoubles();
  localStorage.clear();
});

/** The seeded patient who has a closed visit, so a new one can be started. */
function patientWithBackend(prepare: Parameters<typeof fakeApi>[0] = () => undefined) {
  let patientId = "";
  const backend = fakeApi((fixtures) => {
    prepare(fixtures);
    const sunrise = fixtures.clinics.find((c) => c.slug === "sunrise");
    const visit = fixtures.visits.find((v) => v.clinic_id === sunrise?.id);
    patientId = visit?.patient_id ?? "";
  });
  return { backend, patientId, path: `/patients/${patientId}` };
}

function choose(layout: P360Layout, who: string = PEOPLE.asha) {
  localStorage.setItem(layoutKey(who), layout);
}

const doctorsDay = (user: User) => user.click(screen.getByRole("button", { name: "End visit" }));

/** Seats the patient in the chair, as the desk would, so there is a token to send for payment. */
async function seatPatient(backend: ReturnType<typeof fakeApi>, patientId: string) {
  const api = backend.client({ host: "sunrise.localtest.me", getToken: () => fakeTokenFor({ id: PEOPLE.asha }), now: () => NOW });
  const added = await api.addWalkIn({ patient_id: patientId });
  if (!added.ok) throw new Error("walk-in failed");
  const seated = await api.setQueueStatus(added.value.id, { status: "in_chair" });
  if (!seated.ok) throw new Error("seat failed");
  return async () => {
    const queue = await api.listQueue(undefined);
    if (!queue.ok) throw new Error("queue failed");
    return queue.value.items.find((t) => t.id === added.value.id)?.status;
  };
}

async function axeViolations(): Promise<string[]> {
  const result = await axe.run(document.body, { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } });
  return result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
}

describe("The visit bar", () => {
  it("starts a visit with one click and runs a timer from the visit's start", async () => {
    const user = userEvent.setup();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    const { path, backend } = patientWithBackend();
    renderPortal(path, { as: PEOPLE.asha, backend });
    expect(screen.queryByRole("timer", { name: "Visit time" })).toBeNull();
    await user.click(await screen.findByRole("button", { name: "Start visit" }));
    // No dialog stands between the click and the visit.
    const timer = await screen.findByRole("timer", { name: "Visit time" });
    expect(timer.textContent).toBe("00:00");
    vi.setSystemTime(new Date(NOW.getTime() + 95_000));
    await waitFor(() => {
      expect(screen.getByRole("timer", { name: "Visit time" }).textContent).toBe("01:35");
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: "End visit" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Start visit" })).toBeNull();
  });

  it("formats the time and money it is given", () => {
    expect(elapsed(0)).toBe("00:00");
    expect(elapsed(75)).toBe("01:15");
    expect(elapsed(3725)).toBe("1:02:05");
    expect(elapsed(-5)).toBe("00:00");
    expect(paiseOf("500")).toBe(50000);
    expect(paiseOf("1,250.50")).toBe(125050);
    expect(paiseOf("")).toBeUndefined();
    expect(paiseOf("0")).toBeUndefined();
    expect(paiseOf("abc")).toBeUndefined();
  });

  it("has no axe violations mid-visit, with the timer and the recorder showing", async () => {
    const user = userEvent.setup();
    installVoiceDoubles();
    const { path, backend } = patientWithBackend();
    renderPortal(path, { as: PEOPLE.asha, backend });
    await user.click(await screen.findByRole("button", { name: "Start visit" }));
    await user.click(await screen.findByRole("button", { name: "Start speaking" }));
    await screen.findByRole("timer", { name: "Recording time" });
    expect(await axeViolations()).toEqual([]);
  });
});

describe("Voice notes", () => {
  it("offers English, Hindi, Marathi and Gujarati, shows the live transcript, and pauses and resumes", async () => {
    const user = userEvent.setup();
    installVoiceDoubles();
    const { path, backend } = patientWithBackend();
    renderPortal(path, { as: PEOPLE.asha, backend });
    await user.click(await screen.findByRole("button", { name: "Start visit" }));

    const language = await screen.findByLabelText("Language");
    expect(within(language).getAllByRole("option").map((o) => o.getAttribute("value"))).toEqual(["en-IN", "hi-IN", "mr-IN", "gu-IN"]);
    await user.selectOptions(language, "hi-IN");
    await user.click(screen.getByRole("button", { name: "Start speaking" }));
    await screen.findByRole("timer", { name: "Recording time" });
    const first = FakeRecognition.instances[0];
    expect(first?.lang).toBe("hi-IN");

    const transcript = screen.getByLabelText("Live transcript");
    act(() => {
      first?.say("pain on", false);
    });
    expect(transcript.textContent).toContain("pain on");
    act(() => {
      first?.say("pain on chewing", true);
    });
    expect(transcript.textContent).toContain("pain on chewing");

    await user.click(screen.getByRole("button", { name: "Pause" }));
    expect(screen.getByRole("timer", { name: "Recording time" }).textContent).toContain("Paused");
    // The visit cannot end with a recording open.
    expect(screen.getByRole("button", { name: "End visit" })).toHaveProperty("disabled", true);
    await user.click(screen.getByRole("button", { name: "Resume" }));
    expect(screen.getByRole("timer", { name: "Recording time" }).textContent).toContain("Recording");
    const second = FakeRecognition.instances.at(-1);
    act(() => {
      second?.say("since two days", true);
    });
    expect(transcript.textContent).toBe("pain on chewing since two days");
  });

  it("keeps several notes in one visit, each stamped with its start time, and shows them together in order", async () => {
    const user = userEvent.setup();
    installVoiceDoubles();
    vi.useFakeTimers({ toFake: ["Date"] });
    const uploads: { kind: unknown; note: unknown; visit: unknown }[] = [];
    const { path, backend } = patientWithBackend();
    renderPortal(path, {
      as: PEOPLE.asha,
      backend,
      wrap: (client) => ({
        ...client,
        uploadAttachment: (id, form, options) => {
          uploads.push({ kind: form.get("kind"), note: form.get("note_id"), visit: form.get("visit_id") });
          return client.uploadAttachment(id, form, options);
        },
      }),
    });
    vi.setSystemTime(new Date("2026-10-03T05:30:00Z"));
    await user.click(await screen.findByRole("button", { name: "Start visit" }));

    // First note.
    const firstAt = new Date();
    await user.click(await screen.findByRole("button", { name: "Start speaking" }));
    await screen.findByRole("timer", { name: "Recording time" });
    act(() => {
      FakeRecognition.instances.at(-1)?.say("pain on the lower left", true);
    });
    await user.click(screen.getByRole("button", { name: "Save" }));
    const list = await screen.findByRole("list", { name: "Voice notes" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(1);

    // Seven minutes later, a second one.
    vi.setSystemTime(new Date("2026-10-03T05:37:00Z"));
    const secondAt = new Date();
    await user.click(await screen.findByRole("button", { name: "Start speaking" }));
    await screen.findByRole("timer", { name: "Recording time" });
    act(() => {
      FakeRecognition.instances.at(-1)?.say("swelling on the left cheek", true);
    });
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(within(screen.getByRole("list", { name: "Voice notes" })).getAllByRole("listitem")).toHaveLength(2);
    });

    const items = within(screen.getByRole("list", { name: "Voice notes" })).getAllByRole("listitem");
    expect(items.map((li) => li.textContent)).toEqual([`${stamp(firstAt)}pain on the lower left`, `${stamp(secondAt)}swelling on the left cheek`]);
    // One combined note for the visit, one line per voice note, in the order recorded.
    expect(screen.getByLabelText("Subjective")).toHaveProperty("value", `[${stamp(firstAt)}] pain on the lower left\n[${stamp(secondAt)}] swelling on the left cheek`);
    // The audio of each is kept with the same note.
    expect(uploads).toHaveLength(2);
    expect(uploads.every((u) => u.kind === "audio" && u.note === uploads[0]?.note && typeof u.visit === "string")).toBe(true);
  });
});

describe("Ending the visit and payment", () => {
  it("sends the patient for payment: the open token becomes ready to bill, then the celebration shows", async () => {
    const user = userEvent.setup();
    const { path, backend, patientId } = patientWithBackend();
    const statusOf = await seatPatient(backend, patientId);
    renderPortal(path, { as: PEOPLE.asha, backend });
    await user.click(await screen.findByRole("button", { name: "Start visit" }));
    await doctorsDay(user);
    // The one top button now offers payment, not another visit.
    expect(await screen.findByRole("button", { name: "Collect payment" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "End visit" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Send for payment" }));
    await screen.findByRole("dialog", { name: "Visit completed" });
    expect(await statusOf()).toBe("ready_to_bill");
  });

  it("collects cash: one POST /payments with an idempotency key, kept across a retry, then Finish", async () => {
    const user = userEvent.setup();
    const { path, backend } = patientWithBackend();
    const payments: { input: NewPayment; key: string }[] = [];
    renderPortal(path, {
      as: PEOPLE.asha,
      backend,
      wrap: (client) => ({
        ...client,
        recordPayment: (input, key, options) => {
          payments.push({ input, key });
          // The first attempt is lost on the way; the retry must carry the same key.
          return payments.length === 1
            ? Promise.resolve({ ok: false, error: { status: 503, code: "unavailable", message: "The connection dropped." } })
            : client.recordPayment(input, key, options);
        },
      }),
    });
    await user.click(await screen.findByRole("button", { name: "Start visit" }));
    await user.type(await screen.findByLabelText(/^Fee/), "500");
    await doctorsDay(user);
    await user.click(await screen.findByRole("button", { name: "Collect payment" }));

    const drawer = await screen.findByRole("dialog", { name: "Collect payment" });
    expect(await within(drawer).findByText("₹500")).toBeTruthy();
    expect(within(drawer).getByRole("radio", { name: "Cash" }).getAttribute("aria-checked")).toBe("true");
    await user.click(within(drawer).getByRole("button", { name: "Record payment" }));
    expect((await within(drawer).findAllByRole("alert")).some((a) => /connection dropped/.test(a.textContent))).toBe(true);
    await user.click(within(drawer).getByRole("button", { name: "Record payment" }));
    expect(await within(drawer).findByText(/Paid in full/)).toBeTruthy();

    expect(payments).toHaveLength(2);
    expect(payments[0]?.key).toMatch(/^[0-9a-f-]{36}$/);
    expect(payments[1]?.key).toBe(payments[0]?.key);
    expect(payments[1]?.input).toMatchObject({ method: "cash", amount_paise: 50000 });
    expect(payments[1]?.input.allocations).toHaveLength(1);

    await user.click(within(drawer).getByRole("button", { name: "Finish" }));
    await screen.findByRole("dialog", { name: "Visit completed" });
  });

  it("shows the clinic's UPI QR for UPI, and records the method chosen", async () => {
    const user = userEvent.setup();
    const { path, backend } = patientWithBackend();
    const payments: NewPayment[] = [];
    renderPortal(path, {
      as: PEOPLE.asha,
      backend,
      wrap: (client) => ({
        ...client,
        recordPayment: (input, key, options) => {
          payments.push(input);
          return client.recordPayment(input, key, options);
        },
      }),
    });
    await user.click(await screen.findByRole("button", { name: "Start visit" }));
    await user.type(await screen.findByLabelText(/^Fee/), "300");
    await doctorsDay(user);
    await user.click(await screen.findByRole("button", { name: "Collect payment" }));
    const drawer = await screen.findByRole("dialog", { name: "Collect payment" });
    await within(drawer).findByText("₹300");
    await user.click(within(drawer).getByRole("radio", { name: "UPI" }));
    expect(await within(drawer).findByText(/sunrisedental@okicici/)).toBeTruthy();
    expect(within(drawer).getByRole("img", { name: /UPI QR for ₹300/ })).toBeTruthy();
    expect(await axeViolations()).toEqual([]);
    await user.click(within(drawer).getByRole("button", { name: "Record payment" }));
    await within(drawer).findByText(/Paid in full/);
    expect(payments[0]?.method).toBe("upi");
  });

  it("makes a bill from a fee typed at the desk when the visit ended without one, and takes a partial card payment", async () => {
    const user = userEvent.setup();
    const { path, backend } = patientWithBackend();
    renderPortal(path, { as: PEOPLE.asha, backend });
    await user.click(await screen.findByRole("button", { name: "Start visit" }));
    await doctorsDay(user);
    await user.click(await screen.findByRole("button", { name: "Collect payment" }));
    const drawer = await screen.findByRole("dialog", { name: "Collect payment" });
    await user.type(await within(drawer).findByLabelText(/^Fee/), "400");
    await user.click(within(drawer).getByRole("button", { name: "Make the bill" }));
    await within(drawer).findByText("₹400");
    await user.click(within(drawer).getByRole("radio", { name: "Card" }));
    await user.type(within(drawer).getByLabelText(/^Amount/), "150");
    await user.click(within(drawer).getByRole("button", { name: "Record payment" }));
    expect(await within(drawer).findByText(/Recorded ₹150/)).toBeTruthy();
    expect(within(drawer).getByText("₹250")).toBeTruthy();
  });

  it("hides Collect payment without billing.write, and still sends for payment", async () => {
    const user = userEvent.setup();
    const { path, backend, patientId } = patientWithBackend((fixtures) => {
      const membership = fixtures.memberships.find((m) => m.user_id === PEOPLE.farah);
      // A clinician who can run a visit and move the queue, but not take money.
      if (membership !== undefined) {
        membership.role = {
          key: "clinician",
          name: "Clinician",
          permissions: ["patients.read", "appointments.read", "appointments.write", "clinical.read", "clinical.write", "prescriptions.issue"],
        };
      }
    });
    const statusOf = await seatPatient(backend, patientId);
    renderPortal(path, { as: PEOPLE.farah, backend });
    await user.click(await screen.findByRole("button", { name: "Start visit" }));
    expect(screen.queryByLabelText(/^Fee/)).toBeNull();
    await doctorsDay(user);
    expect(await screen.findByRole("button", { name: "Send for payment" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Collect payment" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Send for payment" }));
    await screen.findByRole("dialog", { name: "Visit completed" });
    expect(await statusOf()).toBe("ready_to_bill");
  });
});

describe("The other layouts", () => {
  it("keeps one recorder across Stage drawers: closing the Voice drawer does not stop a recording", async () => {
    const user = userEvent.setup();
    installVoiceDoubles();
    choose("stage");
    const { path, backend } = patientWithBackend();
    renderPortal(path, { as: PEOPLE.asha, backend });
    await user.click(await screen.findByRole("button", { name: "Start visit" }));
    await user.click(await screen.findByRole("button", { name: "Voice" }));
    await user.click(await screen.findByRole("button", { name: "Start speaking" }));
    await screen.findByRole("timer", { name: "Recording time" });
    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Today's notes" })).toBeNull();
    });
    // Reopen: still recording, and the visit still cannot end.
    await user.click(screen.getByRole("button", { name: "Voice" }));
    expect((await screen.findByRole("timer", { name: "Recording time" })).textContent).toContain("Recording");
    expect(FakeRecognition.instances).toHaveLength(1);
  });

  it("takes the ribbon mic in Tabs to the recorder's button", async () => {
    const user = userEvent.setup();
    choose("tabs");
    const { path, backend } = patientWithBackend();
    renderPortal(path, { as: PEOPLE.asha, backend });
    await user.click(await screen.findByRole("button", { name: "Start visit" }));
    await user.click(await screen.findByRole("tab", { name: "More" }));
    await user.click(screen.getByRole("button", { name: "Go to the voice recorder" }));
    await waitFor(() => {
      expect(document.activeElement?.textContent).toBe("Start speaking");
    });
  });
});

describe("X-rays, photos and what a visit holds", () => {
  it("uploads with a tag from the dropdown, shows the gallery on the patient page, and filters by tag", async () => {
    const user = userEvent.setup();
    const { path, backend } = patientWithBackend();
    const forms: { label: unknown; kind: unknown; visit: unknown }[] = [];
    renderPortal(path, {
      as: PEOPLE.asha,
      backend,
      wrap: (client) => ({
        ...client,
        uploadAttachment: (id, form, options) => {
          forms.push({ label: form.get("label"), kind: form.get("kind"), visit: form.get("visit_id") });
          return client.uploadAttachment(id, form, options);
        },
      }),
    });
    const section = await screen.findByRole("region", { name: "X-rays and photos" });
    expect(await within(section).findByText("No images yet")).toBeTruthy();

    const add = async (tag: string, name: string) => {
      await user.click(within(section).getByRole("button", { name: "Add X-ray or photo" }));
      const dialog = await screen.findByRole("dialog", { name: "Add an X-ray or photo" });
      expect(within(dialog).getAllByRole("option").map((o) => o.textContent)).toEqual(["X-ray", "Intraoral", "Extraoral", "Report", "Other"]);
      await user.selectOptions(within(dialog).getByLabelText("Tag"), tag);
      await user.upload(within(dialog).getByLabelText("Image"), new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], name, { type: "image/png" }));
      await user.click(within(dialog).getByRole("button", { name: "Upload" }));
      await waitFor(() => {
        expect(screen.queryByRole("dialog", { name: "Add an X-ray or photo" })).toBeNull();
      });
    };
    await add("Intraoral", "upper.png");
    await add("X-ray", "opg.png");
    expect(forms.map((f) => [f.label, f.kind])).toEqual([
      ["Intraoral", "photo"],
      ["X-ray", "xray"],
    ]);

    const grid = await within(section).findByRole("list", { name: "Images" });
    expect(within(grid).getAllByRole("button")).toHaveLength(2);
    await user.selectOptions(within(section).getByLabelText("Show"), "X-ray");
    expect(within(within(section).getByRole("list", { name: "Images" })).getAllByRole("button")).toHaveLength(1);
    await user.click(within(section).getByRole("button", { name: /^Open X-ray/ }));
    const viewer = await screen.findByRole("dialog", { name: "X-ray" });
    expect(await within(viewer).findByRole("img", { name: "X-ray" })).toBeTruthy();
  });

  it("opens a visit from the history and shows its notes, treatments, prescription, images and payment", async () => {
    const user = userEvent.setup();
    const { path, backend } = patientWithBackend();
    renderPortal(path, { as: PEOPLE.asha, backend });
    await user.click(await screen.findByRole("button", { name: "Start visit" }));

    // A note, an X-ray tied to the visit, a prescription and a fee.
    const complaints = await screen.findByRole("group", { name: "Complaint" });
    await user.click(within(complaints).getByRole("button", { name: "Toothache" }));
    await screen.findAllByText(/Complains of toothache/);
    const section = screen.getByRole("region", { name: "X-rays and photos" });
    await user.click(within(section).getByRole("button", { name: "Add X-ray or photo" }));
    const dialog = await screen.findByRole("dialog", { name: "Add an X-ray or photo" });
    await user.upload(within(dialog).getByLabelText("Image"), new File([new Uint8Array([137, 80, 78, 71])], "bitewing.png", { type: "image/png" }));
    await user.click(within(dialog).getByRole("button", { name: "Upload" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Add an X-ray or photo" })).toBeNull();
    });
    await user.click(await screen.findByRole("button", { name: /Post-extraction/ }));
    await screen.findAllByPlaceholderText("Medicine name");
    await user.type(screen.getByLabelText(/^Fee/), "500");
    await user.click(screen.getByRole("button", { name: "End visit" }));
    await user.click(await screen.findByRole("button", { name: "Issue and end" }));
    await user.click(await screen.findByRole("button", { name: "Collect payment" }));
    const drawer = await screen.findByRole("dialog", { name: "Collect payment" });
    await within(drawer).findByText("₹500");
    await user.click(within(drawer).getByRole("button", { name: "Record payment" }));
    await within(drawer).findByText(/Paid in full/);
    await user.click(within(drawer).getByRole("button", { name: "Finish" }));
    const done = await screen.findByRole("dialog", { name: "Visit completed" });
    await user.click(within(done).getByRole("button", { name: "Done" }));

    // History: click the visit that was just done.
    await user.click(screen.getByText(/^Visit history/));
    const rows = await screen.findAllByRole("button", { name: /^Open visit / });
    const newest = rows.at(0);
    if (newest === undefined) throw new Error("no visit in the history");
    await user.click(newest);
    const detail = await screen.findByRole("dialog", { name: /^Visit / });
    expect(await within(detail).findByText(/Complains of toothache/)).toBeTruthy();
    expect(within(detail).getByRole("region", { name: "Treatments" })).toBeTruthy();
    expect(await within(within(detail).getByRole("region", { name: "Prescriptions" })).findByRole("link")).toBeTruthy();
    expect(await within(detail).findByRole("button", { name: /^Open X-ray/ })).toBeTruthy();
    const payment = within(detail).getByRole("region", { name: "Payment" });
    expect(await within(payment).findByText("CASH", { exact: false })).toBeTruthy();
    expect(payment.textContent).toContain("₹500");
    expect(payment.textContent).toMatch(/Paid/);
  });
});
