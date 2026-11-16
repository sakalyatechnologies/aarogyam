import { describe, expect, it } from "vitest";

import { patientId, type ApiClient } from "../index.js";
import { ROLES, createFakeBackend, createFixtures, fakeTokenFor } from "./index.js";

const NOW = new Date("2026-11-15T05:30:00Z");
const FARAH = "a1a1a1a1-0000-4000-8000-000000000003";
const BINA = "b1b1b1b1-0000-4000-8000-000000000001";
const CSV = 'Naav,Mobile No.,Baki\nAsha Rane,9876543210,"1,200"\nVijay Patil,9876500001,Rs 500\nMeera Kale,9876500002,0\nRavi Joshi,9876500003,-300\nNeha Pawar,9876500004,abc12\n';
const MAPPING = { mapping: { full_name: 0, phone: 1, balance: 2 } };

function setup(prepare: (fixtures: ReturnType<typeof createFixtures>) => void = () => undefined) {
  const fixtures = createFixtures({ now: NOW });
  prepare(fixtures);
  const backend = createFakeBackend(fixtures);
  const as = (id: string, host = "sunrise.localtest.me"): ApiClient => backend.client({ host, getToken: () => fakeTokenFor({ id }), now: () => NOW });
  return { fixtures, as };
}

async function upload(api: ApiClient) {
  const form = new FormData();
  form.set("file", new File([CSV], "register.csv", { type: "text/csv" }));
  const out = await api.uploadImportFile(form);
  if (!out.ok) throw new Error(`upload failed: ${out.error.message}`);
  return out.value;
}

describe("the import keeps its original file (fake)", () => {
  it("returns the file on upload, a link to it, and deletes it without ending the session", async () => {
    const { as } = setup();
    const api = as(FARAH);
    const session = await upload(api);
    expect(session.file).toMatchObject({ file_name: "register.csv", mime_type: "text/csv" });

    const link = await api.getImportFileDownloadLink(session.id);
    expect(link.ok && link.value.url).toContain(`/imports/sessions/${session.id}/file/content?token=`);

    expect((await api.deleteImportFile(session.id)).ok).toBe(true);
    // Deleting again is fine; the link is gone; the session still works.
    expect((await api.deleteImportFile(session.id)).ok).toBe(true);
    const gone = await api.getImportFileDownloadLink(session.id);
    expect(!gone.ok && gone.error.status).toBe(404);
    expect((await api.previewImport(session.id, MAPPING)).ok).toBe(true);
  });

  it("is a 404 for another clinic and a 403 without patients.write", async () => {
    const { as } = setup();
    const session = await upload(as(FARAH));
    const other = as(BINA, "lotus.localtest.me");
    const link = await other.getImportFileDownloadLink(session.id);
    expect(!link.ok && link.error.status).toBe(404);
    const removed = await other.deleteImportFile(session.id);
    expect(!removed.ok && removed.error.status).toBe(404);

    const assistant = setup((fixtures) => {
      const membership = fixtures.memberships.find((m) => m.user_id === FARAH);
      if (membership !== undefined) membership.role = ROLES.assistant;
    }).as(FARAH);
    const denied = await assistant.getImportFileDownloadLink(session.id);
    expect(!denied.ok && denied.error.status).toBe(403);
  });
});

describe("the balance column becomes opening-balance bills (fake)", () => {
  it("previews amounts, commits one issued bill per owing row, and warns without echoing values", async () => {
    const { as } = setup();
    const api = as(FARAH);
    const session = await upload(api);

    const preview = await api.previewImport(session.id, MAPPING);
    if (!preview.ok) throw new Error("preview failed");
    expect(preview.value.opening_bills).toBe(2);
    expect(preview.value.opening_total_paise).toBe(170_000);
    expect(preview.value.rows.map((r) => r.opening_balance_paise ?? null)).toEqual([120_000, 50_000, null, null, null]);
    const warnings = preview.value.rows.flatMap((r) => r.warnings);
    expect(warnings.some((w) => w.startsWith("balance: negative"))).toBe(true);
    expect(warnings.some((w) => w.startsWith("balance: not an amount we can read"))).toBe(true);
    expect(warnings.join(" ")).not.toMatch(/abc12|300/);

    const done = await api.commitImport(session.id, MAPPING);
    if (!done.ok) throw new Error("commit failed");
    expect(done.value.opening_bills).toBe(2);
    expect(done.value.opening_total_paise).toBe(170_000);

    // The bills are issued, one line, no tax, and the patient owes the amount.
    const first = done.value.rows[0]?.patient_id;
    if (first == null) throw new Error("no patient");
    const bills = await api.listInvoices({ patientId: patientId.parse(first) });
    if (!bills.ok) throw new Error("list failed");
    const [bill] = bills.value.items;
    expect(bill?.status).toBe("issued");
    expect(bill?.total_paise).toBe(120_000);

    // A repeated commit returns the recorded result and makes no second bill.
    const again = await api.commitImport(session.id, MAPPING);
    expect(again.ok && again.value.opening_bills).toBe(2);
    const after = await api.listInvoices({ patientId: patientId.parse(first) });
    expect(after.ok && after.value.items.length).toBe(1);
  });

  it("imports the patients without bills for someone who may not issue them", async () => {
    const { as } = setup((fixtures) => {
      const membership = fixtures.memberships.find((m) => m.user_id === FARAH);
      if (membership !== undefined) membership.role = { ...ROLES.frontDesk, permissions: ROLES.frontDesk.permissions.filter((p) => !p.startsWith("billing.")) };
    });
    const api = as(FARAH);
    const session = await upload(api);
    const preview = await api.previewImport(session.id, MAPPING);
    if (!preview.ok) throw new Error("preview failed");
    expect(preview.value.opening_bills).toBe(0);
    expect(preview.value.opening_total_paise ?? null).toBeNull();
    expect(preview.value.rows.every((r) => r.opening_balance_paise == null)).toBe(true);
    expect(preview.value.notes.join(" ")).toContain("billing.write");
    const done = await api.commitImport(session.id, MAPPING);
    expect(done.ok && done.value.imported).toBe(5);
    expect(done.ok && done.value.opening_bills).toBe(0);
  });
});
