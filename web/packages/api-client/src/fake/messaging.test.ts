import { describe, expect, it } from "vitest";

import type { ApiClient, ApiResult } from "../index.js";
import { createFakeBackend, createFixtures, fakeTokenFor } from "./index.js";

const NOW = new Date("2026-10-03T05:30:00Z");
const ASHA = "a1a1a1a1-0000-4000-8000-000000000001";
const DEV = "a1a1a1a1-0000-4000-8000-000000000002";
const FARAH = "a1a1a1a1-0000-4000-8000-000000000003";
const HOST = "sunrise.localtest.me";

function setup() {
  const backend = createFakeBackend(createFixtures({ now: NOW }));
  return (who: string, host = HOST): ApiClient => backend.client({ host, getToken: () => fakeTokenFor({ id: who }), now: () => NOW });
}
function value<T>(result: ApiResult<T>): T {
  if (!result.ok) throw new Error(`expected success, got ${String(result.error.status)} ${result.error.message}`);
  return result.value;
}
const status = <T>(result: ApiResult<T>) => (result.ok ? 200 : result.error.status);

describe("fake client: patient messages", () => {
  it("sends to 1 to 50 patients from an approved template and lists the status", async () => {
    const owner = setup()(ASHA);
    const patients = value(await owner.listPatients()).items;
    const [first] = patients;
    if (first === undefined) throw new Error("no patient");
    const sent = value(
      await owner.sendMessages({ patient_ids: [first.id], channel: "email", template_key: "care.note", body: "Hello", variables: { subject: "Note" } }),
    );
    expect(sent.queued + sent.already_queued).toBe(1);
    expect(value(await owner.listPatientMessages(first.id)).items).toHaveLength(1);
    expect(status(await owner.sendMessages({ patient_ids: [], channel: "email", template_key: "care.note", body: "x" }))).toBe(400);
    const many = [...patients.map((p) => p.id), ...Array.from({ length: 51 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`)].slice(0, 51);
    expect(many).toHaveLength(51);
    expect(status(await owner.sendMessages({ patient_ids: many, channel: "email", template_key: "reminder.follow_up" }))).toBe(400);
    expect(status(await owner.sendMessages({ patient_ids: [first.id], channel: "email", template_key: "appointment.reminder" }))).toBe(400);
  });

  it("needs messages.send", async () => {
    const farah = setup()(FARAH);
    expect(status(await farah.listMessageTemplates())).toBe(200);
    const noRole = setup()(DEV, "lotus.localtest.me");
    expect(status(await noRole.listCampaigns())).toBe(403);
  });
});

describe("fake client: campaigns", () => {
  it("schedules only with the token of a preview of its own audience", async () => {
    const owner = setup()(ASHA);
    const filter = { kind: "all_active" };
    const audience = value(await owner.createAudience({ name: "Everyone", filter }));
    const template = value(await owner.listMessageTemplates()).items.find((t) => t.key === "promo.offer" && t.status === "approved");
    if (template === undefined) throw new Error("no template");
    const made = value(await owner.createCampaign({ audience_id: audience.id, template_id: template.id, channel: "email", name: "Autumn", offer_text: "15% off" }));
    expect(status(await owner.scheduleCampaign(made.id, { count_token: "" }))).toBe(400);
    expect(status(await owner.scheduleCampaign(made.id, { count_token: "made-up" }))).toBe(409);
    const other = value(await owner.previewAudience({ kind: "sex", sex: "female" }));
    expect(status(await owner.scheduleCampaign(made.id, { count_token: other.count_token }))).toBe(409);
    const preview = value(await owner.previewAudience(filter));
    const scheduled = value(await owner.scheduleCampaign(made.id, { count_token: preview.count_token }));
    expect(scheduled.status).toBe("scheduled");
    expect(scheduled.scheduled_count).toBe(preview.count);
    expect(status(await owner.cancelCampaign(made.id))).toBe(200);
  });
});

describe("fake client: staff chat", () => {
  it("lists unread, polls with the after cursor, and clears unread on read", async () => {
    const as = setup();
    const owner = as(ASHA);
    const doctor = as(FARAH);
    const list = value(await doctor.listConversations()).items;
    const general = list.find((c) => c.title === "General");
    if (general === undefined) throw new Error("no general chat");
    expect(general.unread).toBeGreaterThan(0);
    expect(value(await doctor.getBadges()).chat_unread).toBeGreaterThanOrEqual(general.unread);

    const page = value(await doctor.listChatMessages(general.id)).items;
    const newest = page.at(-1);
    if (newest === undefined) throw new Error("no messages");
    expect(value(await doctor.listChatMessages(general.id, { after: newest.id })).items).toEqual([]);
    const mine = value(await owner.postChatMessage(general.id, { body: "Hello team", client_id: "c-1" }));
    expect(value(await owner.postChatMessage(general.id, { body: "Hello team", client_id: "c-1" })).id).toBe(mine.id);
    expect(value(await doctor.listChatMessages(general.id, { after: newest.id })).items.map((m) => m.id)).toEqual([mine.id]);

    value(await doctor.markConversationRead(general.id, mine.id));
    const after = value(await doctor.listConversations()).items.find((c) => c.id === general.id);
    expect(after?.unread).toBe(0);
  });

  it("keeps a direct chat idempotent, mutes and leaves a group", async () => {
    const as = setup();
    const owner = as(ASHA);
    const people = value(await owner.listStaff()).members;
    const other = people.find((m) => m.user_id !== ASHA);
    if (other === undefined) throw new Error("no colleague");
    const first = value(await owner.startConversation({ kind: "direct", membership_id: other.id }));
    const again = value(await owner.startConversation({ kind: "direct", membership_id: other.id }));
    expect(again.id).toBe(first.id);
    expect(again.created).toBe(false);
    const group = value(await owner.startConversation({ kind: "group", title: "Lab", member_ids: [other.id] }));
    value(await owner.muteConversation(group.id, true));
    expect(value(await owner.listConversations()).items.find((c) => c.id === group.id)?.muted).toBe(true);
    value(await owner.leaveConversation(group.id));
    expect(value(await owner.listConversations()).items.some((c) => c.id === group.id)).toBe(false);
  });
});
