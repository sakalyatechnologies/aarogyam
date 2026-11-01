import { describe, expect, it } from "vitest";

import type { ApiClient, ApiResult } from "../index.js";
import { createFakeBackend, createFixtures, fakeTokenFor } from "./index.js";

const NOW = new Date("2026-10-03T05:30:00Z");
const ASHA = "a1a1a1a1-0000-4000-8000-000000000001";
const HOST = "sunrise.localtest.me";

function value<T>(result: ApiResult<T>): T {
  if (!result.ok) throw new Error(`expected success, got ${String(result.error.status)} ${result.error.message}`);
  return result.value;
}
const status = <T>(result: ApiResult<T>) => (result.ok ? 200 : result.error.status);

describe("fake client: consent signature", () => {
  it("accepts only a consent file of the same patient", async () => {
    const backend = createFakeBackend(createFixtures({ now: NOW }));
    const owner: ApiClient = backend.client({ host: HOST, getToken: () => fakeTokenFor({ id: ASHA }), now: () => NOW });
    const [first, second] = value(await owner.listPatients()).items;
    if (first === undefined || second === undefined) throw new Error("need two patients");
    const upload = async (patient: typeof first.id, kind: string) => {
      const form = new FormData();
      form.set("kind", kind);
      form.set("file", new File([new Uint8Array([0xff, 0xd8, 0xff])], "s.jpg", { type: "image/jpeg" }));
      return value(await owner.uploadAttachment(patient, form)).id;
    };
    const signature = await upload(first.id, "consent");
    const photo = await upload(first.id, "photo");
    const elsewhere = await upload(second.id, "consent");
    const base = { purpose: "care", method: "paper" } as const;
    expect(status(await owner.recordConsent(first.id, { ...base, signature_attachment_id: photo }))).toBe(400);
    expect(status(await owner.recordConsent(first.id, { ...base, signature_attachment_id: elsewhere }))).toBe(400);
    expect(status(await owner.recordConsent(first.id, { ...base, signature_attachment_id: "0192f1c4-7a10-7c3e-9b2a-1d2e3f405199" }))).toBe(404);
    const made = value(await owner.recordConsent(first.id, { ...base, signature_attachment_id: signature }));
    expect(made.signature_attachment_id).toBe(signature);
    expect(value(await owner.listConsents(first.id)).items[0]?.signature_attachment_id).toBe(signature);
  });
});
