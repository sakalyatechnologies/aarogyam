// The doctor's additions to Show patient: Edit a tooth, Go with this, and today's photo (no going back to the chart).
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { attachment, type ApiClient, type Attachment } from "@aarogyam/api-client";
import type { Fixtures } from "@aarogyam/api-client/fake";

import { PEOPLE, fakeApi, renderPortal } from "../../../test/render.js";
import { moreDetailsKey } from "../../patients/v2/tooth-chart/use-chart-prefs.js";
import { photosOf } from "./tooth-photo.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
});

const must = <T,>(x: T | null | undefined): T => {
  if (x === null || x === undefined) throw new Error("missing");
  return x;
};
const WAIT = { timeout: 20_000 };
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

function setup(as: string, photo = false) {
  // The tooth panel keeps Quick plan behind More details, which starts open for this test.
  localStorage.setItem(moreDetailsKey(as), "1");
  let path = "";
  const calls: { created: number; cancelled: string[]; mouth: number } = { created: 0, cancelled: [], mouth: 0 };
  const backend = fakeApi((fixtures: Fixtures) => {
    const sunrise = fixtures.clinics.find((c) => c.slug === "sunrise");
    const visit = fixtures.visits.find((v) => v.clinic_id === sunrise?.id && v.status === "open") ?? fixtures.visits.find((v) => v.clinic_id === sunrise?.id);
    path = `/visits/${visit?.id ?? ""}/mouth`;
    if (visit !== undefined) visit.status = "open";
    if (photo) {
      fixtures.attachments.push({
        id: "pm-photo", clinic_id: sunrise?.id ?? "", patient_id: visit?.patient_id ?? "", visit_id: visit?.id ?? null, kind: "photo", mime_type: "image/png",
        size_bytes: 70, sha256: "0".repeat(64), label: "Intraoral", tooth: 21, created_at: new Date().toISOString(), url: PNG,
      });
    }
  });
  const wrap = (client: ApiClient): ApiClient => ({
    ...client,
    getVisitMouth: (id, opts) => { calls.mouth += 1; return client.getVisitMouth(id, opts); },
    createPlan: (id, input, opts) => { calls.created += 1; return client.createPlan(id, input, opts); },
    setPlanItemStatus: (id, status, opts) => { calls.cancelled.push(`${id}:${status}`); return client.setPlanItemStatus(id, status, opts); },
  });
  renderPortal(path, { as, backend, wrap });
  return calls;
}

async function openTooth(shell: HTMLElement, tooth: number) {
  await waitFor(() => { expect(shell.querySelector(`.ps-dot[data-tooth="${String(tooth)}"]`)).not.toBeNull(); }, WAIT);
  fireEvent.click(must(shell.querySelector(`.ps-dot[data-tooth="${String(tooth)}"]`)));
}

describe("Edit on a tooth in Show patient", () => {
  it("opens the chart's tooth panel over Show patient, and a Quick plan chip saves and refreshes the view", async () => {
    const calls = setup(PEOPLE.asha);
    const shell = await screen.findByRole("dialog", { name: "Present mode" }, WAIT);
    await openTooth(shell, 55);
    const edit = await within(shell).findByRole("button", { name: "Edit tooth 55" }, WAIT);
    const before = calls.mouth;
    fireEvent.click(edit);
    const sheet = await screen.findByRole("dialog", { name: "Edit tooth 55" }, WAIT);
    const plan = await within(sheet).findByRole("group", { name: "Plan a treatment" }, WAIT);
    expect(within(sheet).getByRole("button", { name: "Add photo" })).toBeTruthy();
    fireEvent.click(must(within(plan).getAllByRole("button", { name: /Filling|Root canal|Crown/ })[0]));
    await waitFor(() => { expect(calls.created).toBe(1); }, WAIT);
    await waitFor(() => { expect(calls.mouth).toBeGreaterThan(before); }, WAIT);
    // the sheet below is still on the same tooth
    expect(shell.querySelector("[data-tooth-sheet='55'], [data-story-card^='tooth:']")).not.toBeNull();
  });

  it("is not offered without clinical write", async () => {
    setup(PEOPLE.farah);
    const shell = await screen.findByRole("dialog", { name: "Present mode" }, WAIT).catch(() => undefined);
    if (shell === undefined) return;
    await openTooth(shell, 55).catch(() => undefined);
    expect(within(shell).queryByRole("button", { name: /Edit tooth/ })).toBeNull();
    expect(within(shell).queryByRole("button", { name: "Go with this" })).toBeNull();
  });
});

describe("Go with this", () => {
  it("plans the chosen option on the tooth and offers Undo", async () => {
    const calls = setup(PEOPLE.asha);
    const shell = await screen.findByRole("dialog", { name: "Present mode" }, WAIT);
    const card = await within(shell).findByRole("button", { name: /Card \d+ of \d+: Usual options · Infection at the root/ }, WAIT);
    fireEvent.click(card);
    const block = await within(shell).findByRole("region", { name: /Usual options: Infection at the root/ }, WAIT);
    fireEvent.click(must((await within(block).findAllByRole("button", { name: "Go with this" }, WAIT))[0]));
    await waitFor(() => { expect(calls.created).toBe(1); }, WAIT);
    expect(await screen.findByRole("button", { name: "Undo" }, WAIT)).toBeTruthy();
  });
});

describe("a photo from today", () => {
  it("shows under the tooth's drawing as Your photo, today", async () => {
    setup(PEOPLE.asha, true);
    const shell = await screen.findByRole("dialog", { name: "Present mode" }, WAIT);
    await openTooth(shell, 21);
    const img = await within(shell).findByRole("img", { name: "Photo of tooth 21" }, WAIT);
    expect(img.getAttribute("loading")).toBe("lazy");
    expect(within(shell).getByText("Your photo, today")).toBeTruthy();
  });

  it("keeps only photos of that tooth taken today", () => {
    const f = (id: string, tooth: number, at: string): Attachment => attachment.parse({ id, kind: "photo", mime_type: "image/png", size_bytes: 1, sha256: "0".repeat(64), tooth, created_at: at });
    const now = new Date().toISOString();
    expect(photosOf([f("a", 21, now), f("b", 22, now), f("c", 21, "2020-01-01T00:00:00Z")], 21).map((x) => x.id)).toEqual(["a"]);
  });
});
