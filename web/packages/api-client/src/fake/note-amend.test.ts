import { describe, expect, it } from "vitest";

import { createHttpClient, noteId, unwrap, type ApiClient } from "../index.js";
import { createFakeBackend, createFixtures, fakeTokenFor } from "./index.js";

const NOW = new Date("2026-10-03T05:30:00Z");
const SUNRISE = "sunrise.localtest.me";
const LOTUS = "lotus.localtest.me";
const ASHA = "a1a1a1a1-0000-4000-8000-000000000001";
const DEV = "a1a1a1a1-0000-4000-8000-000000000002";
const FARAH = "a1a1a1a1-0000-4000-8000-000000000003";
const BINA = "b1b1b1b1-0000-4000-8000-000000000001";

function setup() {
  const backend = createFakeBackend(createFixtures({ now: NOW }));
  const as = (who: string, host = SUNRISE): ApiClient => backend.client({ host, getToken: () => fakeTokenFor({ id: who }), now: () => NOW });
  return { as };
}

describe("fake client: correcting a note keeps the original", () => {
  it("saves a new signed version that supersedes the signed original, even once the visit is closed", async () => {
    const { as } = setup();
    const patient = (await unwrap(as(ASHA).listPatients())).items[0];
    if (patient === undefined) throw new Error("expected a patient");
    const visit = await unwrap(as(ASHA).startVisit(patient.id, {}));
    const draft = await unwrap(as(ASHA).createNote(visit.id, { sections: { subjective: "[10:05] pain in 36" } }));
    // An open visit's draft is edited in place, not corrected.
    expect((await as(ASHA).amendNote(draft.id, { sections: { subjective: "x" } })).ok).toBe(false);
    await unwrap(as(ASHA).signNote(draft.id));
    await unwrap(as(ASHA).closeVisit(visit.id));

    // Another doctor may correct it; the original stays.
    const fixed = await unwrap(as(DEV).amendNote(draft.id, { sections: { subjective: "[10:05] pain in 46" } }));
    expect(fixed).toMatchObject({ status: "signed", supersedes_id: draft.id, sections: { subjective: "[10:05] pain in 46" } });
    expect(fixed.author.name).toBe("Dr Dev Rao");
    const detail = await unwrap(as(ASHA).getVisit(visit.id));
    // The visit lists only the current note; the original is read from its versions.
    expect(detail.notes.map((n) => n.id)).toEqual([fixed.id]);
    const versions = await unwrap(as(ASHA).listNoteVersions(fixed.id));
    expect(versions.items.map((n) => [n.id, n.sections.subjective])).toEqual([[draft.id, "[10:05] pain in 36"]]);

    // A corrected note takes no in-place edit or retry of its correction under another id.
    const closedEdit = await as(ASHA).editNote(draft.id, { sections: { subjective: "x" } });
    expect(closedEdit.ok ? 200 : closedEdit.error.status).toBe(409);

    // A note is corrected once, and corrections need content and the permission.
    const again = await as(DEV).amendNote(draft.id, { sections: { subjective: "again" } });
    expect(again.ok ? 200 : again.error.status).toBe(409);
    const empty = await as(DEV).amendNote(fixed.id, { sections: { subjective: "  " } });
    expect(empty.ok ? 200 : empty.error.status).toBe(409);
    const desk = await as(FARAH).amendNote(fixed.id, { sections: { subjective: "no" } });
    expect(desk.ok ? 200 : desk.error.status).toBe(403);
    const other = await as(BINA, LOTUS).amendNote(fixed.id, { sections: { subjective: "no" } });
    expect(other.ok ? 200 : other.error.status).toBe(404);
  });
});

describe("http client: amendNote", () => {
  it("posts the whole text to the amend path and checks the answer against the contract", async () => {
    const note = {
      id: "01a103b1-ea26-7120-ad93-41b6b4b4ebf2",
      row_version: 1,
      visit_id: "01a103b1-ea26-7120-ad93-41b6b4b4ebf3",
      author: { id: "01a103b1-ea26-7120-ad93-41b6b4b4ebf4", name: "Dev Doctor" },
      kind: "soap",
      source: "typed",
      status: "signed",
      sections: { subjective: "fixed" },
      addenda: [],
      supersedes_id: "01a103b1-ea26-7120-ad93-41b6b4b4ebf5",
      signed_at: "2026-10-03T05:30:00Z",
      created_at: "2026-10-03T05:30:00Z",
      updated_at: "2026-10-03T05:30:00Z",
    };
    const calls: { url: string; init: RequestInit | undefined }[] = [];
    const fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: input instanceof Request ? input.url : String(input), init });
      return Promise.resolve(new Response(JSON.stringify(note), { status: 201, headers: { "content-type": "application/json" } }));
    };
    const client = createHttpClient("", () => "token", { fetch });
    const result = await unwrap(client.amendNote(noteId.parse(note.id), { sections: { subjective: "fixed" } }));
    expect(result.supersedes_id).toBe(note.supersedes_id);
    expect(calls[0]?.url).toBe(`/api/v1/notes/${note.id}/amend`);
    const sent = calls[0]?.init?.body;
    expect(typeof sent).toBe("string");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(JSON.parse(typeof sent === "string" ? sent : "")).toEqual({ sections: { subjective: "fixed" } });
  });
});
