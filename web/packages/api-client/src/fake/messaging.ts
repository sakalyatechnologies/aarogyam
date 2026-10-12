/**
 * The fake of patient messages, campaigns and staff chat, with the real API's checks: 1 to 50
 * patients, approved templates only, a campaign that sends only with a fresh `count_token`, chat
 * cursors (`after`, `before`) over sortable ids, read pointers and unread counts.
 *
 * Helpers return a value or a `Refusal`; the client turns a refusal into the API's error body.
 */

import type * as C from "../contract.js";
import type { FakeClinic, FakeMembership, FakePatient, FakeUser } from "./fixtures.js";

export class Refusal {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly message: string,
  ) {}
}

export const isRefusal = (value: unknown): value is Refusal => value instanceof Refusal;
const bad = (field: string, problem: string) => new Refusal(400, "invalid_request", `${field}: ${problem}`);
const missing = new Refusal(404, "not_found", "Not found.");

// Stored records -----------------------------------------------------------------------------------

export interface FakeConversation {
  id: string;
  clinic_id: string;
  kind: "direct" | "group";
  title: string | null;
  created_at: string;
  members: { membership_id: string; role: "member" | "admin"; muted: boolean; last_read_message_id: string | null }[];
}

export interface FakeChatMessage extends C.ChatMessage {
  clinic_id: string;
}

export interface FakeSentMessage {
  id: string;
  clinic_id: string;
  patient_id: string;
  batch_id: string;
  template_key: string;
  channel: string;
  purpose: string;
  created_at: string;
  skip_reason: string | null;
}

export interface FakeCampaign {
  id: string;
  clinic_id: string;
  name: string;
  audience_id: string;
  template_id: string;
  channel: string;
  offer_text: string;
  created_at: string;
  created_by: string;
  scheduled_at: string | null;
  scheduled_count: number | null;
  cancelled_at: string | null;
  /** Patients matched when it was scheduled, as `[patient id, skip reason or null]`. */
  recipients: [string, string | null][];
}

export interface FakeAudience extends C.Audience {
  clinic_id: string;
}

export interface FakeTemplate extends C.MessageTemplate {
  clinic_id: string;
}

export interface FakePreviewToken {
  clinic_id: string;
  membership_id: string;
  filter_key: string;
  count: number;
  expires_at: number;
}

export interface MessagingStore {
  memberships: FakeMembership[];
  users: FakeUser[];
  patients: FakePatient[];
  clinics: FakeClinic[];
  conversations?: FakeConversation[];
  chatMessages?: FakeChatMessage[];
  chatSeq?: number;
  sentMessages?: FakeSentMessage[];
  messageTemplates?: FakeTemplate[];
  audiences?: FakeAudience[];
  campaigns?: FakeCampaign[];
  previewTokens?: Record<string, FakePreviewToken>;
}

export interface Who {
  clinic_id: string;
  membership_id: string;
}

/** The ids of what the fake makes sort by creation, like the API's UUIDv7s. */
function sortableId(state: MessagingStore, prefix: string): string {
  state.chatSeq = (state.chatSeq ?? 0) + 1;
  return `${prefix}-0000-7000-8000-${state.chatSeq.toString(16).padStart(12, "0")}`;
}

const hash = (text: string): string => {
  let h = 5381;
  for (let i = 0; i < text.length; i += 1) h = (Math.imul(h, 33) ^ text.charCodeAt(i)) >>> 0;
  return h.toString(16);
};

/** Every fifth patient has not agreed to promotional messages: a send skips them. */
const hasPromotionalConsent = (state: MessagingStore, patient: FakePatient): boolean => {
  const mine = state.patients.filter((p) => p.clinic_id === patient.clinic_id);
  return mine.indexOf(patient) % 5 !== 4;
};

// Templates ----------------------------------------------------------------------------------------

const TEMPLATES: readonly [string, string, string, string][] = [
  ["care.note", "utility", "approved", "Hello {{name}}, a note from {{clinic}}: {{body}}"],
  ["reminder.follow_up", "utility", "approved", "Hello {{name}}, it is time for your follow-up at {{clinic}}. Reply to this email to book a slot."],
  ["promo.offer", "marketing", "approved", "{{offer}}\n\nYou get this because you agreed to hear about offers from {{clinic}}. Reply STOP to opt out."],
  ["appointment.reminder", "utility", "submitted", "Reminder: your visit at {{clinic}} is on {{date}}."],
];

export function templatesOf(state: MessagingStore, clinicId: string, now: Date): FakeTemplate[] {
  state.messageTemplates ??= [];
  if (!state.messageTemplates.some((t) => t.clinic_id === clinicId)) {
    TEMPLATES.forEach(([key, category, status, body], at) => {
      state.messageTemplates?.push({
        clinic_id: clinicId,
        id: `00000000-0000-7000-8001-${(at + 1).toString(16).padStart(12, "0")}-${hash(clinicId)}`.slice(0, 36),
        key,
        channel: "email",
        language: "en-IN",
        category,
        status,
        body,
        updated_at: now.toISOString(),
      });
    });
  }
  return state.messageTemplates.filter((t) => t.clinic_id === clinicId);
}

// Sending to patients ------------------------------------------------------------------------------

const FREE_TEXT_KEYS = ["care.note", "promo.offer"];

export function sendMessages(state: MessagingStore, who: Who, input: C.SendMessages, now: Date): C.MessagesQueued | Refusal {
  const ids = [...new Set(input.patient_ids)];
  if (ids.length < 1 || ids.length > 50) return bad("patient_ids", "give 1 to 50 patients");
  if (input.channel !== "email") return bad("channel", "only email for now");
  const template = templatesOf(state, who.clinic_id, now).find((t) => t.key === input.template_key && t.status === "approved");
  if (template === undefined) return bad("template_key", "no approved template with this key");
  const text = input.body?.trim() ?? "";
  if (FREE_TEXT_KEYS.includes(input.template_key)) {
    if (text === "") return bad("body", "write the message");
    if ((input.variables?.subject ?? "").trim() === "") return bad("variables", "subject is needed");
  }
  if (text.length > 5000) return bad("body", "up to 5000 characters");
  const patients = ids.map((id) => state.patients.find((p) => p.id === id && p.clinic_id === who.clinic_id));
  if (patients.some((p) => p === undefined)) return missing;

  state.sentMessages ??= [];
  const batch = input.batch_id ?? sortableId(state, "00000001");
  const before = state.sentMessages.filter((m) => m.batch_id === batch && m.clinic_id === who.clinic_id);
  const purpose = input.template_key === "promo.offer" ? "promotional" : input.template_key === "reminder.follow_up" ? "reminders" : "care";
  let queued = 0;
  let already = 0;
  for (const patient of patients) {
    if (patient === undefined) continue;
    if (before.some((m) => m.patient_id === patient.id)) {
      already += 1;
      continue;
    }
    const skip =
      purpose === "promotional" && !hasPromotionalConsent(state, patient) ? "no_consent" : (patient.email ?? "") === "" ? "no_address" : null;
    state.sentMessages.push({
      id: sortableId(state, "00000002"),
      clinic_id: who.clinic_id,
      patient_id: patient.id,
      batch_id: batch,
      template_key: input.template_key,
      channel: input.channel,
      purpose,
      created_at: now.toISOString(),
      skip_reason: skip,
    });
    queued += 1;
  }
  return { batch_id: batch, requested: ids.length, queued, already_queued: already };
}

/** A queued message is sent a few seconds later, as the outbox job would. */
const SEND_AFTER_MS = 4000;

export function patientMessages(state: MessagingStore, who: Who, patientId: string, now: Date): C.MessageList | Refusal {
  if (!state.patients.some((p) => p.id === patientId && p.clinic_id === who.clinic_id)) return missing;
  const items = (state.sentMessages ?? [])
    .filter((m) => m.clinic_id === who.clinic_id && m.patient_id === patientId)
    .sort((a, b) => (a.id < b.id ? 1 : -1))
    .map((m): C.MessageSummary => {
      const due = now.getTime() - Date.parse(m.created_at) >= SEND_AFTER_MS;
      const skipped = m.skip_reason !== null;
      return {
        id: m.id,
        kind: "clinic.message",
        channel: m.channel,
        purpose: m.purpose,
        template_key: m.template_key,
        status: skipped ? "skipped" : due ? "sent" : "queued",
        attempts: skipped || !due ? 0 : 1,
        created_at: m.created_at,
        scheduled_for: m.created_at,
        sent_at: !skipped && due ? new Date(Date.parse(m.created_at) + SEND_AFTER_MS).toISOString() : null,
        delivery: !skipped && due ? "delivered" : null,
        skip_reason: m.skip_reason,
      };
    });
  return { items };
}

// Audiences and campaigns --------------------------------------------------------------------------

const FILTER_KINDS = ["all_active", "last_visit", "birthday_month", "age_band", "sex", "tag"];

function ageOn(birth: string, now: Date): number {
  const born = new Date(`${birth}T00:00:00Z`);
  let age = now.getUTCFullYear() - born.getUTCFullYear();
  if (now.getUTCMonth() < born.getUTCMonth() || (now.getUTCMonth() === born.getUTCMonth() && now.getUTCDate() < born.getUTCDate())) age -= 1;
  return age;
}

function checkFilter(filter: C.AudienceFilter): Refusal | null {
  if (!FILTER_KINDS.includes(filter.kind)) return bad("filter.kind", "unknown value");
  if (filter.kind === "birthday_month" && (filter.month == null || filter.month < 1 || filter.month > 12)) return bad("filter.month", "1 to 12");
  if (filter.kind === "age_band") {
    if (filter.min == null && filter.max == null) return bad("filter.min", "give a youngest or an oldest age");
    if (filter.min != null && filter.max != null && filter.min > filter.max) return bad("filter.min", "can't be above the oldest age");
  }
  if (filter.kind === "sex" && !["female", "male", "other", "unknown"].includes(filter.sex ?? "")) return bad("filter.sex", "unknown value");
  if (filter.kind === "tag" && (filter.tag ?? "").trim() === "") return bad("filter.tag", "give a tag");
  return null;
}

function matching(state: MessagingStore, who: Who, filter: C.AudienceFilter, now: Date): FakePatient[] {
  return state.patients.filter((p) => {
    if (p.clinic_id !== who.clinic_id || p.status !== "active") return false;
    switch (filter.kind) {
      case "last_visit": {
        const last = p.last_visit_at ?? null;
        if (last === null) return false;
        const day = last.slice(0, 10);
        return (filter.before == null || day < filter.before) && (filter.after == null || day >= filter.after);
      }
      case "birthday_month":
        return p.date_of_birth != null && Number(p.date_of_birth.slice(5, 7)) === filter.month;
      case "age_band": {
        if (p.date_of_birth == null) return false;
        const age = ageOn(p.date_of_birth, now);
        return (filter.min == null || age >= filter.min) && (filter.max == null || age <= filter.max);
      }
      case "sex":
        return p.sex === filter.sex;
      case "tag":
        return false;
      default:
        return true;
    }
  });
}

const filterKey = (filter: C.AudienceFilter): string => JSON.stringify(Object.entries(filter).filter(([, v]) => v != null).sort());

const TOKEN_MS = 15 * 60 * 1000;

export function previewAudience(state: MessagingStore, who: Who, filter: C.AudienceFilter, now: Date): C.AudiencePreview | Refusal {
  const refused = checkFilter(filter);
  if (refused !== null) return refused;
  const count = matching(state, who, filter, now).length;
  const expires = now.getTime() + TOKEN_MS;
  const token = `${String(expires)}.${hash(`${who.clinic_id}|${who.membership_id}|${filterKey(filter)}|${String(count)}|${String(expires)}`)}`;
  state.previewTokens ??= {};
  state.previewTokens[token] = { clinic_id: who.clinic_id, membership_id: who.membership_id, filter_key: filterKey(filter), count, expires_at: expires };
  return { count, count_token: token, expires_at: new Date(expires).toISOString() };
}

export function createAudience(state: MessagingStore, who: Who, input: C.NewAudience, now: Date): C.Audience | Refusal {
  const name = input.name.trim();
  if (name === "" || name.length > 80) return bad("name", "1 to 80 characters");
  const refused = checkFilter(input.filter);
  if (refused !== null) return refused;
  state.audiences ??= [];
  const row: FakeAudience = {
    clinic_id: who.clinic_id,
    id: sortableId(state, "00000003"),
    name,
    filter: input.filter,
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
  };
  state.audiences.push(row);
  return wireAudience(row);
}

function wireAudience(row: FakeAudience): C.Audience {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- the clinic stays on the server
  const { clinic_id, ...wire } = row;
  return wire;
}

export function wireTemplate(row: FakeTemplate): C.MessageTemplate {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- the clinic stays on the server
  const { clinic_id, ...wire } = row;
  return wire;
}

export function createCampaign(state: MessagingStore, who: Who, input: C.NewCampaign, now: Date): C.Campaign | Refusal {
  const name = input.name.trim();
  const offer = input.offer_text.trim();
  if (name === "" || name.length > 80) return bad("name", "1 to 80 characters");
  if (offer === "" || offer.length > 1000) return bad("offer_text", "1 to 1000 characters");
  if (input.channel !== "email") return bad("channel", "only email for now");
  if (!(state.audiences ?? []).some((a) => a.id === input.audience_id && a.clinic_id === who.clinic_id)) return missing;
  const template = templatesOf(state, who.clinic_id, now).find((t) => t.id === input.template_id);
  if (template === undefined) return missing;
  if (template.key !== "promo.offer" || template.status !== "approved") return bad("template_id", "a campaign sends the approved promo.offer template");
  state.campaigns ??= [];
  const row: FakeCampaign = {
    id: sortableId(state, "00000004"),
    clinic_id: who.clinic_id,
    name,
    audience_id: input.audience_id,
    template_id: input.template_id,
    channel: input.channel,
    offer_text: offer,
    created_at: now.toISOString(),
    created_by: who.membership_id,
    scheduled_at: null,
    scheduled_count: null,
    cancelled_at: null,
    recipients: [],
  };
  state.campaigns.push(row);
  return wireCampaign(row, now);
}

export function wireCampaign(row: FakeCampaign, now: Date): C.Campaign {
  const elapsed = row.scheduled_at === null ? 0 : now.getTime() - Date.parse(row.scheduled_at);
  const done = row.scheduled_at !== null && row.cancelled_at === null && elapsed >= SEND_AFTER_MS;
  const status = row.cancelled_at !== null ? "cancelled" : row.scheduled_at === null ? "draft" : done ? "sent" : "scheduled";
  const counts: C.Campaign["counts"] = [];
  if (row.scheduled_at !== null && row.cancelled_at === null) {
    const tally = new Map<string, number>();
    for (const [, skip] of row.recipients) {
      const key = skip === null ? (done ? "sent" : "queued") : `skipped:${skip}`;
      tally.set(key, (tally.get(key) ?? 0) + 1);
    }
    for (const [key, count] of tally) {
      const [state, reason] = key.split(":");
      counts.push({ status: state ?? "queued", count, skip_reason: reason ?? null });
    }
  }
  return {
    id: row.id,
    name: row.name,
    audience_id: row.audience_id,
    template_id: row.template_id,
    channel: row.channel,
    offer_text: row.offer_text,
    status,
    counts,
    created_at: row.created_at,
    updated_at: row.scheduled_at ?? row.created_at,
    created_by: row.created_by,
    scheduled_at: row.scheduled_at,
    scheduled_count: row.scheduled_count,
    cancelled_at: row.cancelled_at,
  };
}

export function campaignsOf(state: MessagingStore, who: Who, now: Date): C.Campaigns {
  return {
    items: (state.campaigns ?? [])
      .filter((c) => c.clinic_id === who.clinic_id)
      .sort((a, b) => (a.id < b.id ? 1 : -1))
      .map((c) => wireCampaign(c, now)),
  };
}

export function campaignOf(state: MessagingStore, who: Who, id: string): FakeCampaign | Refusal {
  return (state.campaigns ?? []).find((c) => c.id === id && c.clinic_id === who.clinic_id) ?? missing;
}

/** Schedules with the token of a fresh preview of the audience: no token, a stale one or another filter is refused. */
export function scheduleCampaign(state: MessagingStore, who: Who, id: string, input: C.ScheduleCampaign, now: Date): C.Campaign | Refusal {
  const row = campaignOf(state, who, id);
  if (isRefusal(row)) return row;
  const token = typeof input.count_token === "string" ? input.count_token.trim() : "";
  if (token === "") return bad("count_token", "preview the audience first");
  if (row.scheduled_at !== null || row.cancelled_at !== null) return new Refusal(409, "conflict", "this campaign is already scheduled or cancelled");
  const audience = (state.audiences ?? []).find((a) => a.id === row.audience_id);
  const proof = state.previewTokens?.[token];
  if (audience === undefined || proof?.clinic_id !== who.clinic_id || proof.membership_id !== who.membership_id) {
    return new Refusal(409, "conflict", "count_token: preview the audience again");
  }
  const now_ms = now.getTime();
  const people = matching(state, who, audience.filter, now);
  if (proof.expires_at < now_ms || proof.filter_key !== filterKey(audience.filter) || proof.count !== people.length) {
    return new Refusal(409, "conflict", "count_token: the audience changed or the preview expired, preview it again");
  }
  row.scheduled_at = now.toISOString();
  row.scheduled_count = people.length;
  row.recipients = people.map((p): [string, string | null] => [
    p.id,
    !hasPromotionalConsent(state, p) ? "no_consent" : (p.email ?? "") === "" ? "no_address" : null,
  ]);
  return wireCampaign(row, now);
}

export function cancelCampaign(state: MessagingStore, who: Who, id: string, now: Date): C.Campaign | Refusal {
  const row = campaignOf(state, who, id);
  if (isRefusal(row)) return row;
  const done = wireCampaign(row, now).status === "sent";
  if (row.cancelled_at !== null || done) return new Refusal(409, "conflict", "this campaign can't be cancelled");
  row.cancelled_at = now.toISOString();
  return wireCampaign(row, now);
}

// Staff chat ---------------------------------------------------------------------------------------

const nameOf = (state: MessagingStore, membershipId: string): string => {
  const member = state.memberships.find((m) => m.id === membershipId);
  return state.users.find((u) => u.id === member?.user_id)?.display_name ?? "Colleague";
};

function post(state: MessagingStore, conversation: FakeConversation, author: string, body: string, at: Date, clientId?: string): FakeChatMessage {
  state.chatMessages ??= [];
  const id = sortableId(state, "00000005");
  const row: FakeChatMessage = {
    clinic_id: conversation.clinic_id,
    id,
    conversation_id: conversation.id,
    author_membership_id: author,
    author_name: nameOf(state, author),
    body,
    client_id: clientId ?? id,
    created_at: at.toISOString(),
    deleted: false,
  };
  state.chatMessages.push(row);
  return row;
}

/** A clinic's first look at chat: a clinic-wide group and a chat between the first two colleagues, with a few messages. */
function ensureChat(state: MessagingStore, clinicId: string, now: Date): void {
  state.conversations ??= [];
  if (state.conversations.some((c) => c.clinic_id === clinicId)) return;
  const people = state.memberships.filter((m) => m.clinic_id === clinicId && (m.status ?? "active") === "active");
  if (people.length === 0) return;
  const at = (minutesAgo: number) => new Date(now.getTime() - minutesAgo * 60_000);
  const group: FakeConversation = {
    id: sortableId(state, "00000006"),
    clinic_id: clinicId,
    kind: "group",
    title: "General",
    created_at: at(600).toISOString(),
    members: people.map((m, i) => ({ membership_id: m.id, role: i === 0 ? "admin" : "member", muted: false, last_read_message_id: null })),
  };
  state.conversations.push(group);
  const [first, second] = people;
  if (first !== undefined) post(state, group, first.id, "Clinic closed on Dussehra (12 Oct). Please move bookings to Monday.", at(300));
  if (second !== undefined) post(state, group, second.id, "Noted, calling the patients now.", at(280));
  if (first !== undefined && second !== undefined) {
    const direct: FakeConversation = {
      id: sortableId(state, "00000006"),
      clinic_id: clinicId,
      kind: "direct",
      title: null,
      created_at: at(200).toISOString(),
      members: [first, second].map((m) => ({ membership_id: m.id, role: "member" as const, muted: false, last_read_message_id: null })),
    };
    state.conversations.push(direct);
    post(state, direct, second.id, "Can you review the IOPA before 3?", at(120));
  }
}

const mineOf = (state: MessagingStore, who: Who, id: string): FakeConversation | undefined =>
  (state.conversations ?? []).find((c) => c.id === id && c.clinic_id === who.clinic_id && c.members.some((m) => m.membership_id === who.membership_id));

function unreadOf(state: MessagingStore, conversation: FakeConversation, membershipId: string): number {
  const me = conversation.members.find((m) => m.membership_id === membershipId);
  const read = me?.last_read_message_id ?? "";
  const unread = (state.chatMessages ?? []).filter(
    (m) => m.conversation_id === conversation.id && m.author_membership_id !== membershipId && !m.deleted && m.id > read,
  ).length;
  return Math.min(unread, 100);
}

export function listConversations(state: MessagingStore, who: Who, now: Date, limit = 50): C.ConversationList {
  ensureChat(state, who.clinic_id, now);
  const items = (state.conversations ?? [])
    .filter((c) => c.clinic_id === who.clinic_id && c.members.some((m) => m.membership_id === who.membership_id))
    .map((c): { item: C.ConversationItem; last: string } => {
      const me = c.members.find((m) => m.membership_id === who.membership_id);
      const messages = (state.chatMessages ?? []).filter((m) => m.conversation_id === c.id);
      const last = messages.at(-1);
      const other = c.kind === "direct" ? c.members.find((m) => m.membership_id !== who.membership_id) : undefined;
      return {
        last: last?.created_at ?? c.created_at,
        item: {
          id: c.id,
          kind: c.kind,
          role: me?.role ?? "member",
          muted: me?.muted ?? false,
          unread: unreadOf(state, c, who.membership_id),
          created_at: c.created_at,
          title: c.title,
          last_message_at: last?.created_at ?? null,
          last_message_id: last?.id ?? null,
          last_read_message_id: me?.last_read_message_id ?? null,
          with: other === undefined ? null : { membership_id: other.membership_id, name: nameOf(state, other.membership_id) },
        },
      };
    })
    .sort((a, b) => (a.last < b.last ? 1 : -1))
    .slice(0, limit)
    .map((x) => x.item);
  return { items };
}

export function startConversation(state: MessagingStore, who: Who, input: C.NewConversation, now: Date): { body: C.ConversationStarted; created: boolean } | Refusal {
  ensureChat(state, who.clinic_id, now);
  const active = (id: string) => state.memberships.some((m) => m.id === id && m.clinic_id === who.clinic_id && (m.status ?? "active") === "active");
  if (input.kind === "direct") {
    const other = input.membership_id ?? "";
    if (other === who.membership_id) return bad("membership_id", "can't chat with yourself");
    if (!active(other)) return missing;
    const found = (state.conversations ?? []).find(
      (c) => c.clinic_id === who.clinic_id && c.kind === "direct" && c.members.some((m) => m.membership_id === other) && c.members.some((m) => m.membership_id === who.membership_id),
    );
    if (found !== undefined) return { body: { id: found.id, created: false }, created: false };
    const row: FakeConversation = {
      id: sortableId(state, "00000006"),
      clinic_id: who.clinic_id,
      kind: "direct",
      title: null,
      created_at: now.toISOString(),
      members: [who.membership_id, other].map((id) => ({ membership_id: id, role: "member" as const, muted: false, last_read_message_id: null })),
    };
    state.conversations?.push(row);
    return { body: { id: row.id, created: true }, created: true };
  }
  if (input.kind !== "group") return bad("kind", "direct or group");
  const title = (input.title ?? "").trim();
  if (title === "" || title.length > 80) return bad("title", "1 to 80 characters");
  const others = [...new Set(input.member_ids ?? [])].filter((id) => id !== who.membership_id);
  if (others.length === 0) return bad("member_ids", "add at least one colleague");
  if (!others.every(active)) return missing;
  const row: FakeConversation = {
    id: sortableId(state, "00000006"),
    clinic_id: who.clinic_id,
    kind: "group",
    title,
    created_at: now.toISOString(),
    members: [who.membership_id, ...others].map((id, i) => ({ membership_id: id, role: i === 0 ? ("admin" as const) : ("member" as const), muted: false, last_read_message_id: null })),
  };
  state.conversations?.push(row);
  return { body: { id: row.id, created: true }, created: true };
}

export function chatMessages(
  state: MessagingStore,
  who: Who,
  id: string,
  query: { after?: string; before?: string; limit?: number },
): C.ChatMessageList | Refusal {
  const conversation = mineOf(state, who, id);
  if (conversation === undefined) return missing;
  if (query.after !== undefined && query.before !== undefined) return bad("before", "can't be used with after");
  const limit = Math.min(Math.max(query.limit ?? 50, 1), 100);
  const all = (state.chatMessages ?? []).filter((m) => m.conversation_id === id).sort((a, b) => (a.id < b.id ? -1 : 1));
  const page =
    query.after !== undefined
      ? all.filter((m) => m.id > (query.after ?? "")).slice(0, limit)
      : (query.before !== undefined ? all.filter((m) => m.id < (query.before ?? "")) : all).slice(-limit);
  return { items: page.map(wireMessage) };
}

function wireMessage(m: FakeChatMessage): C.ChatMessage {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- the clinic stays on the server
  const { clinic_id, ...wire } = m;
  return m.deleted ? { ...wire, body: null } : wire;
}

export function postChatMessage(state: MessagingStore, who: Who, id: string, input: C.NewChatMessage, now: Date): C.ChatMessage | Refusal {
  const conversation = mineOf(state, who, id);
  if (conversation === undefined) return missing;
  const body = input.body.trim();
  if (body === "" || body.length > 4000) return bad("body", "1 to 4000 characters");
  if (input.client_id.trim() === "") return bad("client_id", "needed");
  const again = (state.chatMessages ?? []).find((m) => m.conversation_id === id && m.author_membership_id === who.membership_id && m.client_id === input.client_id);
  if (again !== undefined) return wireMessage(again);
  return wireMessage(post(state, conversation, who.membership_id, body, now, input.client_id));
}

/** The pointer never moves back. */
export function markRead(state: MessagingStore, who: Who, id: string, messageId: string): null | Refusal {
  const conversation = mineOf(state, who, id);
  if (conversation === undefined) return missing;
  if (!(state.chatMessages ?? []).some((m) => m.id === messageId && m.conversation_id === id)) return missing;
  const me = conversation.members.find((m) => m.membership_id === who.membership_id);
  if (me !== undefined && (me.last_read_message_id ?? "") < messageId) me.last_read_message_id = messageId;
  return null;
}

export function muteConversation(state: MessagingStore, who: Who, id: string, muted: boolean): null | Refusal {
  const conversation = mineOf(state, who, id);
  const me = conversation?.members.find((m) => m.membership_id === who.membership_id);
  if (me === undefined) return missing;
  me.muted = muted;
  return null;
}

export function leaveConversation(state: MessagingStore, who: Who, id: string): null | Refusal {
  const conversation = mineOf(state, who, id);
  if (conversation === undefined) return missing;
  if (conversation.kind === "direct") return new Refusal(409, "conflict", "a direct chat can't be left");
  conversation.members = conversation.members.filter((m) => m.membership_id !== who.membership_id);
  return null;
}

export function badges(state: MessagingStore, who: Who, now: Date): C.Badges {
  const items = listConversations(state, who, now, 100).items;
  return { chat_unread: items.filter((c) => !c.muted).reduce((sum, c) => sum + c.unread, 0), notifications_unread: null, tasks_open: 0 };
}
