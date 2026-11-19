import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { timelineEvent, patientId, unwrap, visit as visitSchema, type TimelineEvent, type Visit } from "@aarogyam/api-client";
import { fakeTokenFor, type Fixtures } from "@aarogyam/api-client/fake";

import { NEW_LOOK_KEY } from "../../../lib/new-look.js";
import { NOW, PEOPLE, fakeApi, renderPortal } from "../../../test/render.js";
import { FakeRecognition, installVoiceDoubles, removeVoiceDoubles } from "../../visits/voice/test-doubles.js";
import { layoutKey } from "./use-layout.js";
import { stamp } from "./use-voice-notes.js";
import { groupTimeline, VisitTimeline } from "./visit-timeline.js";

type User = ReturnType<typeof userEvent.setup>;

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(NEW_LOOK_KEY, "1");
  localStorage.setItem(layoutKey(PEOPLE.asha), "console");
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  removeVoiceDoubles();
  localStorage.clear();
});

function patientIdOf(path: string) {
  return patientId.parse(path.split("/")[2]);
}

function first<T>(items: readonly T[]): T {
  const [head] = items;
  if (head === undefined) throw new Error("nothing found");
  return head;
}

/** The seeded patient, whose one visit is closed, so a new visit can be started. */
function patientWithBackend(prepare: Parameters<typeof fakeApi>[0] = () => undefined) {
  let patientId = "";
  let shared: Fixtures | undefined;
  const backend = fakeApi((fixtures) => {
    shared = fixtures;
    prepare(fixtures);
    const sunrise = fixtures.clinics.find((c) => c.slug === "sunrise");
    patientId = fixtures.visits.find((v) => v.clinic_id === sunrise?.id)?.patient_id ?? "";
  });
  if (shared === undefined) throw new Error("fixtures were not made");
  return { backend, fixtures: shared, path: `/patients/${patientId}` };
}

async function startVisit(user: User) {
  await user.click(await screen.findByRole("button", { name: "Start visit" }));
}

async function speak(user: User, say: (recognition: FakeRecognition) => void, save = true) {
  await user.click(await screen.findByRole("button", { name: "Start speaking" }));
  await screen.findByRole("timer", { name: "Recording time" });
  act(() => {
    say(FakeRecognition.instances.at(-1) ?? new FakeRecognition());
  });
  if (save) await user.click(screen.getByRole("button", { name: "Save" }));
}

async function axeViolations(): Promise<string[]> {
  const result = await axe.run(document.body, { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } });
  return result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
}

const lines = () => within(screen.getByRole("list", { name: "Voice notes" })).getAllByRole("listitem");

describe("Voice typing in the visit's notes", () => {
  it("saves a spoken phrase into the note: final text appears in the transcript and in the note", async () => {
    const user = userEvent.setup();
    installVoiceDoubles();
    const { path, backend } = patientWithBackend();
    renderPortal(path, { as: PEOPLE.asha, backend });
    await startVisit(user);
    await speak(user, (r) => {
      r.say("pain on the lower left", true);
    });
    await waitFor(() => {
      expect(lines().map((li) => li.textContent)).toEqual([expect.stringMatching(/^\d\d:\d\dpain on the lower left$/)]);
    });
  });

  it("keeps words that were still interim when Save was pressed, instead of saving 'no transcript'", async () => {
    const user = userEvent.setup();
    installVoiceDoubles();
    const { path, backend } = patientWithBackend();
    renderPortal(path, { as: PEOPLE.asha, backend });
    await startVisit(user);
    await user.click(await screen.findByRole("button", { name: "Start speaking" }));
    await screen.findByRole("timer", { name: "Recording time" });
    act(() => {
      FakeRecognition.instances.at(-1)?.say("swelling on the left cheek", false);
    });
    // The live words show while speaking.
    expect(screen.getByLabelText("Live transcript").textContent).toContain("swelling on the left cheek");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(lines().map((li) => li.textContent)).toEqual([expect.stringMatching(/swelling on the left cheek$/)]);
    });
    expect(screen.queryByText(/no transcript/)).toBeNull();
  });

  it("lets the doctor fix the transcript while paused, then dictate on and save the fixed text", async () => {
    const user = userEvent.setup();
    installVoiceDoubles();
    const { path, backend } = patientWithBackend();
    renderPortal(path, { as: PEOPLE.asha, backend });
    await startVisit(user);
    await speak(
      user,
      (r) => {
        r.say("pain on the lower lift", true);
      },
      false,
    );
    await user.click(screen.getByRole("button", { name: "Pause" }));
    const box = screen.getByRole("textbox", { name: "Transcript" });
    await user.clear(box);
    await user.type(box, "pain on the lower left");
    await user.click(screen.getByRole("button", { name: "Resume" }));
    act(() => {
      FakeRecognition.instances.at(-1)?.say("since two days", true);
    });
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(lines().map((li) => li.textContent)).toEqual([expect.stringMatching(/^\d\d:\d\dpain on the lower left since two days$/)]);
    });
  });

  it("discards the note being recorded only after a second tap", async () => {
    const user = userEvent.setup();
    installVoiceDoubles();
    const { path, backend } = patientWithBackend();
    renderPortal(path, { as: PEOPLE.asha, backend });
    await startVisit(user);
    await speak(
      user,
      (r) => {
        r.say("wrong patient", true);
      },
      false,
    );
    await user.click(screen.getByRole("button", { name: "Discard" }));
    await user.click(screen.getByRole("button", { name: "Keep" }));
    expect(screen.getByLabelText("Live transcript").textContent).toContain("wrong patient");
    await user.click(screen.getByRole("button", { name: "Discard" }));
    await user.click(screen.getByRole("button", { name: "Yes, discard" }));
    expect(await screen.findByRole("button", { name: "Start speaking" })).toBeTruthy();
    expect(screen.queryByText("wrong patient")).toBeNull();
    expect(screen.queryByRole("list", { name: "Voice notes" })).toBeNull();
  });

  it("says plainly that voice typing needs Chrome or Edge where there is no speech recognition, and still records", async () => {
    const user = userEvent.setup();
    installVoiceDoubles({ dictation: false });
    const { path, backend } = patientWithBackend();
    renderPortal(path, { as: PEOPLE.asha, backend });
    await startVisit(user);
    expect(await screen.findByText("Voice typing needs Chrome or Edge. You can still record audio and type notes.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Start speaking" }));
    await screen.findByRole("timer", { name: "Recording time" });
    expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
  });

  it("tells the doctor when the browser blocks dictation mid-recording", async () => {
    const user = userEvent.setup();
    installVoiceDoubles();
    const { path, backend } = patientWithBackend();
    renderPortal(path, { as: PEOPLE.asha, backend });
    await startVisit(user);
    await user.click(await screen.findByRole("button", { name: "Start speaking" }));
    await screen.findByRole("timer", { name: "Recording time" });
    act(() => {
      FakeRecognition.instances.at(-1)?.onerror?.({ error: "not-allowed" });
    });
    await waitFor(() => {
      expect(screen.getAllByRole("status").some((s) => s.textContent.includes("Dictation is blocked"))).toBe(true);
    });
  });
});

describe("Typed notes in the same transcript", () => {
  it("adds a typed line with its time, in time order with the voice lines, and edits and deletes a draft line", async () => {
    const user = userEvent.setup();
    installVoiceDoubles();
    vi.useFakeTimers({ toFake: ["Date"] });
    const { path, backend } = patientWithBackend();
    renderPortal(path, { as: PEOPLE.asha, backend });
    vi.setSystemTime(new Date("2026-10-03T05:30:00Z"));
    await startVisit(user);

    // The recording starts first and is saved last, but its line carries the time it started.
    const startedAt = new Date();
    await speak(user, (r) => {
      r.say("pain on the lower left", true);
    }, false);
    vi.setSystemTime(new Date("2026-10-03T05:33:00Z"));
    const typedAt = new Date();
    await user.type(screen.getByRole("textbox", { name: "Type a note" }), "Allergic to penicillin{Enter}");
    await waitFor(() => {
      expect(lines()).toHaveLength(1);
    });
    expect(first(lines()).textContent).toBe(`${stamp(typedAt)}Allergic to penicillin`);
    expect(screen.getByRole("textbox", { name: "Type a note" })).toHaveProperty("value", "");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(lines()).toHaveLength(2);
    });
    expect(lines().map((li) => li.textContent)).toEqual([`${stamp(startedAt)}pain on the lower left`, `${stamp(typedAt)}Allergic to penicillin`]);

    // Edit a line in place.
    await user.click(screen.getByRole("button", { name: `Edit the note at ${stamp(typedAt)}` }));
    const box = screen.getByRole("textbox", { name: `Edit the note at ${stamp(typedAt)}` });
    await user.clear(box);
    await user.type(box, "Allergic to penicillin and aspirin{Enter}");
    await waitFor(() => {
      expect(lines().map((li) => li.textContent)).toEqual([`${stamp(startedAt)}pain on the lower left`, `${stamp(typedAt)}Allergic to penicillin and aspirin`]);
    });
    // Stored in the order saved (the typed line first); shown in time order.
    expect(screen.getByLabelText("Subjective")).toHaveProperty("value", `[${stamp(typedAt)}] Allergic to penicillin and aspirin\n[${stamp(startedAt)}] pain on the lower left`);

    // And delete one.
    await user.click(screen.getByRole("button", { name: `Delete the note at ${stamp(startedAt)}` }));
    await waitFor(() => {
      expect(lines()).toHaveLength(1);
    });
    expect(first(lines()).textContent).toBe(`${stamp(typedAt)}Allergic to penicillin and aspirin`);
  });
});

describe("Writes to the draft go one at a time", () => {
  it("keeps a voice line saved while another line is being deleted", async () => {
    const user = userEvent.setup();
    installVoiceDoubles();
    vi.useFakeTimers({ toFake: ["Date"] });
    let gate = false;
    let release: (() => void) | undefined;
    const { path, backend } = patientWithBackend();
    renderPortal(path, {
      as: PEOPLE.asha,
      backend,
      wrap: (client) => ({
        ...client,
        editNote: (id, content, options) =>
          gate
            ? new Promise((resolve) => {
                gate = false;
                release = () => {
                  resolve(client.editNote(id, content, options));
                };
              })
            : client.editNote(id, content, options),
      }),
    });
    vi.setSystemTime(new Date("2026-10-03T05:30:00Z"));
    await startVisit(user);
    const typedAt = new Date();
    await user.type(await screen.findByRole("textbox", { name: "Type a note" }), "typed first{Enter}");
    await waitFor(() => {
      expect(lines()).toHaveLength(1);
    });

    vi.setSystemTime(new Date("2026-10-03T05:40:00Z"));
    const spokenAt = new Date();
    await speak(
      user,
      (r) => {
        r.say("spoken after", true);
      },
      false,
    );
    // The voice save is held on its way to the server; meanwhile the typed line is deleted.
    gate = true;
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(release).toBeDefined();
    });
    await user.click(screen.getByRole("button", { name: `Delete the note at ${stamp(typedAt)}` }));
    release?.();
    await waitFor(() => {
      expect(lines().map((li) => li.textContent)).toEqual([`${stamp(spokenAt)}spoken after`]);
    });
    expect(screen.getByLabelText("Subjective")).toHaveProperty("value", `[${stamp(spokenAt)}] spoken after`);
  });
});

/** The seeded patient whose closed visit holds a signed note of two lines. */
function visitedWithSignedNote() {
  return patientWithBackend((fixtures) => {
    const note = first(fixtures.notes);
    note.status = "signed";
    note.signed_at = note.signed_at ?? NOW.toISOString();
    note.sections = { ...note.sections, subjective: "[10:05] Pain on the right side\n[10:12] Sensitive to cold" };
  });
}

describe("Editing the notes of a past visit", () => {
  it("saves a correction to a signed note, keeps the original, and shows 'Edited' and the earlier version", async () => {
    const user = userEvent.setup();
    const { path, backend } = visitedWithSignedNote();
    renderPortal(path, { as: PEOPLE.asha, backend });
    const heading = await screen.findByRole("heading", { level: 2, name: "Records" });
    const card = heading.closest("section");
    if (card === null) throw new Error("no Records card");
    await user.click(first(await within(card).findAllByRole("button", { name: /^Open visit / })));
    const detail = await screen.findByRole("dialog", { name: /^Visit / });
    expect(await within(detail).findByText("Pain on the right side")).toBeTruthy();
    expect(within(detail).queryByText(/^See earlier versions/)).toBeNull();

    await user.click(within(detail).getByRole("button", { name: "Edit notes" }));
    expect(within(detail).getByText(/saved as a correction/)).toBeTruthy();
    const subjective = within(detail).getByLabelText("Subjective");
    await user.clear(subjective);
    await user.click(subjective);
    await user.paste("[10:05] Pain on the left side");
    expect(await axeViolations()).toEqual([]);
    await user.click(within(detail).getByRole("button", { name: "Save correction" }));

    expect(await within(detail).findByText("Pain on the left side")).toBeTruthy();
    expect(within(detail).getByText(/Edited .* by /)).toBeTruthy();
    await user.click(within(detail).getByText(/^See earlier versions/));
    const earlier = within(detail).getByRole("list", { name: "Earlier versions" });
    expect(within(earlier).getByText("Pain on the right side")).toBeTruthy();
    expect(within(earlier).getByText(/kept for the record/)).toBeTruthy();
    // Both versions exist in the record; the original is untouched.
    const api = backend.client({ host: "sunrise.localtest.me", getToken: () => fakeTokenFor({ id: PEOPLE.asha }), now: () => NOW });
    const visits = await unwrap(api.listVisits(patientIdOf(path)));
    const record = await unwrap(api.getVisit(first(visits.items.filter((v) => v.status === "closed")).id));
    // The visit lists only the current note; the original is read from its versions.
    expect(record.notes.map((n) => [n.status, n.sections.subjective])).toEqual([["signed", "[10:05] Pain on the left side"]]);
    const earlierOnes = await unwrap(api.listNoteVersions(first(record.notes).id));
    expect(earlierOnes.items.map((n) => n.sections.subjective)).toEqual(["[10:05] Pain on the right side\n[10:12] Sensitive to cold"]);
  });
});

const V1 = "01a103b1-ea26-7120-ad93-41b6b4b4e001";

describe("One timeline entry per visit", () => {
  const visit = visitSchema.parse({
    id: "01a103b1-ea26-7120-ad93-41b6b4b4e001",
    number: "V-7",
    patient_id: "01a103b1-ea26-7120-ad93-41b6b4b4e002",
    status: "closed",
    started_at: "2026-11-16T05:30:00Z",
    chief_complaint: "Toothache",
    clinician: { id: "01a103b1-ea26-7120-ad93-41b6b4b4e003", name: "Dr Dev" },
  });
  const event = (kind: TimelineEvent["kind"], id: string, title: string, visitId: string | null): TimelineEvent =>
    timelineEvent.parse({ kind, id, title, at: "2026-11-16T05:40:00Z", visit_id: visitId });

  it("folds a visit's note and recording into the visit's single entry, with counts, and opens it", async () => {
    const user = userEvent.setup();
    const opened: Visit[] = [];
    const events = [event("note", "n1", "soap", V1), event("attachment", "a1", "audio", V1), event("visit", V1, "V-7", V1)];
    render(<VisitTimeline events={events} visits={[visit]} limit={8} onOpen={(v) => opened.push(v)} />);
    const items = within(screen.getByRole("list", { name: "Clinical history" })).getAllByRole("listitem");
    expect(items).toHaveLength(1);
    expect(items[0]?.textContent).toContain("note, 1 recording");
    expect(items[0]?.textContent).toContain("Dr Dev");
    await user.click(within(first(items)).getByRole("button", { name: /Show what was done/ }));
    expect(opened).toEqual([visit]);
  });

  it("still groups under one entry when the visit isn't in the visits list, with a minimal header", () => {
    const entries = groupTimeline([event("note", "n1", "soap", V1), event("attachment", "a1", "audio", V1)], []);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ kind: "visit", id: V1, title: "Visit", visit: undefined });
  });

  it("orders entries by instant, not by text", () => {
    const whole = timelineEvent.parse({ kind: "attachment", id: "x1", title: "xray", at: "2026-11-16T09:30:00Z" });
    const later = timelineEvent.parse({ kind: "attachment", id: "x2", title: "xray", at: "2026-11-16T09:30:00.500Z" });
    // Half a second later, although as text it sorts before.
    expect(groupTimeline([whole, later], []).map((e) => e.id)).toEqual(["x2", "x1"]);
  });

  it("keeps items that belong to no visit as their own entries", () => {
    const entries = groupTimeline([event("attachment", "a2", "xray", null), event("note", "n1", "soap", V1), event("visit", V1, "V-7", V1)], [visit]);
    expect(entries.map((e) => e.kind).sort()).toEqual(["event", "visit"]);
  });
});
