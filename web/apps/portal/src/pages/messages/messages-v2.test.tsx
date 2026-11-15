import { act, cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { failure, type ApiClient, type MessageStats, type Permission, type SendMessages } from "@aarogyam/api-client";
import { fakeTokenFor } from "@aarogyam/api-client/fake";

import { NEW_LOOK_KEY } from "../../lib/new-look.js";
import { NOW, PEOPLE, fakeApi, renderPortal } from "../../test/render.js";

const SUNRISE = "sunrise.localtest.me";
const AXE = { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } };
const problems = (result: axe.AxeResults) => result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(NEW_LOOK_KEY, "1");
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  localStorage.clear();
});

/** Farah with exactly these permissions. */
function farahWith(permissions: Permission[]) {
  return fakeApi((fixtures) => {
    const membership = fixtures.memberships.find((m) => m.user_id === PEOPLE.farah);
    if (membership !== undefined) membership.role = { key: "reader", name: "Reader", permissions };
  });
}

describe("Messages to patients", () => {
  it("sends one patient an approved template and shows the message status", async () => {
    const calls: SendMessages[] = [];
    const wrap = (client: ApiClient): ApiClient => ({
      ...client,
      sendMessages: (input, options) => {
        calls.push(input);
        return client.sendMessages(input, options);
      },
    });
    const user = userEvent.setup();
    renderPortal("/messages", { as: PEOPLE.asha, wrap });
    const list = await screen.findByRole("group", { name: "Patients" });
    const patients = await within(list).findAllByRole("button");
    const target = patients[0];
    if (target === undefined) throw new Error("no patient");
    await user.click(target);
    await user.selectOptions(await screen.findByLabelText("Template"), "reminder.follow_up");
    await user.click(screen.getByRole("button", { name: "Send to 1 patient" }));
    await screen.findByText(/Queued 1 of 1/);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ channel: "email", template_key: "reminder.follow_up" });
    expect(calls[0]?.patient_ids).toHaveLength(1);
    const history = await screen.findByText("Messages to this patient");
    await waitFor(() => { expect(history.parentElement?.textContent).toMatch(/Queued|Sent|Skipped/); });
    expect(screen.getByRole("note").textContent).toMatch(/agreed to receive/);
  });

  it("asks for a subject and text when the template is the sender's own words", async () => {
    const user = userEvent.setup();
    renderPortal("/messages", { as: PEOPLE.asha });
    const list = await screen.findByRole("group", { name: "Patients" });
    const [first] = await within(list).findAllByRole("button");
    if (first === undefined) throw new Error("no patient");
    await user.click(first);
    await screen.findByLabelText("Template");
    const send = screen.getByRole("button", { name: "Send to 1 patient" });
    expect(send).toHaveProperty("disabled", true);
    await user.type(screen.getByLabelText("Subject"), "Your report");
    await user.type(screen.getByLabelText("Email text"), "Please call us.");
    expect(send).toHaveProperty("disabled", false);
  });

  it("caps a broadcast at 50 patients", async () => {
    const calls: SendMessages[] = [];
    const backend = fakeApi((fixtures) => {
      const [seed] = fixtures.patients.filter((p) => p.clinic_id === fixtures.clinics[0]?.id);
      if (seed === undefined) throw new Error("no seed patient");
      for (let i = 0; i < 20; i += 1) {
        fixtures.patients.push({ ...seed, id: `00000000-0000-4000-8000-${String(900 + i).padStart(12, "0")}`, number: `SD-${String(900 + i)}`, full_name: `Extra Patient ${String(i)}` });
      }
    });
    const wrap = (client: ApiClient): ApiClient => ({
      ...client,
      sendMessages: (input, options) => {
        calls.push(input);
        return client.sendMessages(input, options);
      },
    });
    const user = userEvent.setup();
    renderPortal("/messages", { as: PEOPLE.asha, backend, wrap });
    await user.click(await screen.findByRole("button", { name: "Broadcast" }));
    await user.click(await screen.findByRole("button", { name: /Select first 50/ }));
    expect(screen.getByText("50 of up to 50 chosen")).toBeTruthy();
    await user.selectOptions(await screen.findByLabelText("Template"), "reminder.follow_up");
    await user.click(screen.getByRole("button", { name: "Send to 50 patients" }));
    await screen.findByText(/Queued \d+ of 50/);
    expect(calls[0]?.patient_ids).toHaveLength(50);
    expect(new Set(calls[0]?.patient_ids).size).toBe(50);
  });

  it("schedules an offer only with the token of a preview", async () => {
    const scheduled: string[] = [];
    let failPreview = true;
    const wrap = (client: ApiClient): ApiClient => ({
      ...client,
      previewAudience: (filter, options) =>
        failPreview
          ? Promise.resolve(failure({ status: 500, code: "internal", message: "Count failed." }))
          : client.previewAudience(filter, options),
      scheduleCampaign: (id, input, options) => {
        scheduled.push(input.count_token);
        return client.scheduleCampaign(id, input, options);
      },
    });
    const user = userEvent.setup();
    renderPortal("/messages", { as: PEOPLE.asha, wrap });
    await user.click(await screen.findByRole("button", { name: "Offer" }));
    await user.type(await screen.findByLabelText("Offer name"), "Autumn");
    await user.type(screen.getByLabelText("Offer text"), "15% off cleaning.");
    await screen.findByText(/Couldn't count the audience/);
    const schedule = screen.getByRole("button", { name: /Schedule offer/ });
    expect(schedule).toHaveProperty("disabled", true);
    await user.click(schedule);
    expect(scheduled).toEqual([]);

    // With a count the button turns on, and the request carries that count's token.
    failPreview = false;
    await user.selectOptions(screen.getByLabelText("Audience"), "sex");
    const live = await screen.findByText(/patients match/);
    const count = Number(live.querySelector("b")?.textContent);
    const ready = await screen.findByRole("button", { name: `Schedule offer to ${String(count)} patients` });
    await waitFor(() => { expect(ready).toHaveProperty("disabled", false); });
    await user.click(ready);
    await waitFor(() => { expect(scheduled).toHaveLength(1); });
    expect(scheduled[0]).toMatch(/^\d+\./);
    await screen.findByText("Autumn");
  });
});

describe("Staff chat", () => {
  it("appends a sent message to the thread", async () => {
    const user = userEvent.setup();
    renderPortal("/messages", { as: PEOPLE.asha });
    await user.click(await screen.findByRole("button", { name: "Staff chat" }));
    await user.click(await screen.findByRole("button", { name: /General/ }));
    const log = await screen.findByRole("log", { name: "Messages in General" });
    await within(log).findByText(/Dussehra/);
    await user.type(screen.getByLabelText("Message General"), "Lab van is here{enter}");
    const sent = await within(log).findByText("Lab van is here");
    expect(sent.closest("li")?.textContent).toContain("You ·");
  });

  it("polls for news with the after cursor while the chat is open", async () => {
    const seen: (string | undefined)[] = [];
    const backend = fakeApi();
    const wrap = (client: ApiClient): ApiClient => ({
      ...client,
      listChatMessages: (id, query, options) => {
        seen.push(query?.after);
        return client.listChatMessages(id, query, options);
      },
    });
    const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderPortal("/messages", { as: PEOPLE.asha, backend, wrap });
    await user.click(await screen.findByRole("button", { name: "Staff chat" }));
    await user.click(await screen.findByRole("button", { name: /General/ }));
    const log = await screen.findByRole("log", { name: "Messages in General" });
    await within(log).findByText(/Dussehra/);
    expect(seen).toEqual([undefined]);

    // A colleague writes; the next poll asks only for what is newer than the last message shown.
    const farah = backend.client({ host: SUNRISE, getToken: () => fakeTokenFor({ id: PEOPLE.farah }), now: () => NOW });
    const list = await farah.listConversations();
    if (!list.ok) throw new Error("no conversations");
    const general = list.value.items.find((c) => c.title === "General");
    if (general === undefined) throw new Error("no General");
    await farah.postChatMessage(general.id, { body: "On my way", client_id: "poll-1" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    await within(log).findByText("On my way");
    const last = seen.at(-1);
    expect(last).toBeDefined();
    expect(seen.slice(1).every((after) => after !== undefined)).toBe(true);
  });

  it("clears a chat's unread count when it is opened", async () => {
    const user = userEvent.setup();
    renderPortal("/messages", { as: PEOPLE.farah, backend: farahWith(["chat.use"]) });
    const button = await screen.findByRole("button", { name: /General/ });
    expect(within(button).getByLabelText(/\d+ unread/)).toBeTruthy();
    await user.click(button);
    await within(await screen.findByRole("log", { name: "Messages in General" })).findByText(/Dussehra/);
    await waitFor(() => { expect(within(screen.getByRole("button", { name: /General/ })).queryByLabelText(/unread/)).toBeNull(); });
  });

  it("starts a direct chat and a group, then mutes and leaves the group", async () => {
    const user = userEvent.setup();
    renderPortal("/messages", { as: PEOPLE.asha });
    await user.click(await screen.findByRole("button", { name: "Staff chat" }));
    await user.click(await screen.findByRole("button", { name: /New chat/ }));
    await user.click(await screen.findByRole("button", { name: "Group" }));
    await user.type(screen.getByLabelText("Group name"), "Lab runs");
    const members = await screen.findAllByRole("checkbox");
    const [firstMember] = members;
    if (firstMember === undefined) throw new Error("no colleagues");
    await user.click(firstMember);
    await user.click(screen.getByRole("button", { name: "Start chat" }));
    await screen.findByRole("log", { name: "Messages in Lab runs" });
    await user.click(screen.getByRole("button", { name: /Mute/ }));
    await screen.findByRole("button", { name: /Unmute/ });
    await user.click(screen.getByRole("button", { name: /Leave/ }));
    await user.click(await screen.findByRole("button", { name: "Leave chat" }));
    await waitFor(() => { expect(screen.queryByRole("button", { name: /Lab runs/ })).toBeNull(); });
  });
});

const CHANNEL_ID = "00000000-0000-7000-8000-00000000a002";
/** A clinic with a group and the Everyone channel (the group is listed first by the server, the channel second), and Farah limited to `farahCan` when given. */
function withChannel(farahCan?: Permission[]) {
  return fakeApi((fixtures) => {
    const clinic = fixtures.clinics[0];
    if (clinic === undefined) throw new Error("no clinic");
    const members = fixtures.memberships.filter((m) => m.clinic_id === clinic.id).map((m, i) => ({ membership_id: m.id, role: i === 0 ? ("admin" as const) : ("member" as const), muted: false, last_read_message_id: null }));
    const base = { clinic_id: clinic.id, created_at: "2026-10-01T05:30:00.000Z", members };
    fixtures.conversations = [
      { ...base, id: "00000000-0000-7000-8000-00000000a001", kind: "group", title: "Alpha team" },
      { ...base, id: CHANNEL_ID, kind: "channel", title: "Everyone" },
    ];
    if (farahCan !== undefined) {
      const membership = fixtures.memberships.find((m) => m.user_id === PEOPLE.farah);
      if (membership !== undefined) membership.role = { key: "reader", name: "Reader", permissions: farahCan };
    }
  });
}
const asAsha = (backend: ReturnType<typeof fakeApi>) => backend.client({ host: SUNRISE, getToken: () => fakeTokenFor({ id: PEOPLE.asha }), now: () => NOW });
async function openEveryone(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: /Everyone/ }));
  return screen.findByRole("log", { name: "Messages in Everyone" });
}

describe("Staff chat: the Everyone channel, notices and files", () => {
  it("lists the Everyone channel before the other chats", async () => {
    renderPortal("/messages", { as: PEOPLE.farah, backend: withChannel(["chat.use"]) });
    const list = await screen.findByRole("list", { name: "Conversations" });
    await waitFor(() => {
      expect(within(list).getAllByRole("listitem").map((li) => li.textContent)).toEqual([expect.stringContaining("Everyone"), expect.stringContaining("Alpha team")]);
    });
  });

  it("pins a notice at the top for everyone, posted by someone with chat.notice", async () => {
    const user = userEvent.setup();
    const backend = withChannel(["chat.use"]);
    const posted = await asAsha(backend).postChatMessage(CHANNEL_ID, { body: "Clinic closed on Monday", client_id: "n-1", is_notice: true });
    expect(posted.ok).toBe(true);
    renderPortal("/messages", { as: PEOPLE.farah, backend });
    const log = await openEveryone(user);
    const pinned = await screen.findByText(/Pinned notice/);
    expect(pinned.parentElement?.textContent).toContain("Clinic closed on Monday");
    expect((await within(log).findAllByText(/Clinic closed on Monday/)).length).toBeGreaterThan(0);
    // Farah has no chat.notice: no way to post one.
    expect(screen.queryByRole("checkbox", { name: /Post as notice/ })).toBeNull();
  });

  it("offers Post as notice to chat.notice holders and pins what they post", async () => {
    const user = userEvent.setup();
    const sent: { is_notice?: boolean | undefined; body?: string | null | undefined }[] = [];
    renderPortal("/messages", {
      as: PEOPLE.asha,
      backend: withChannel(),
      wrap: (client) => ({
        ...client,
        postChatMessage: (id, input, options) => {
          sent.push({ is_notice: input.is_notice, body: input.body });
          return client.postChatMessage(id, input, options);
        },
      }),
    });
    await user.click(await screen.findByRole("button", { name: "Staff chat" }));
    await openEveryone(user);
    await user.type(screen.getByLabelText("Message Everyone"), "Fire drill at 4");
    await user.click(screen.getByRole("checkbox", { name: /Post as notice/ }));
    await user.click(screen.getByRole("button", { name: "Send message" }));
    const pinned = await screen.findByText(/Pinned notice/);
    expect(pinned.parentElement?.textContent).toContain("Fire drill at 4");
    expect(sent).toEqual([{ is_notice: true, body: "Fire drill at 4" }]);
    // An ordinary message does not set the flag.
    await user.type(screen.getByLabelText("Message Everyone"), "Thanks all{enter}");
    await screen.findAllByText("Thanks all");
    expect(sent.at(-1)?.is_notice).toBeUndefined();
  });

  it("attaches a file to a message and shows it in the thread with a download", async () => {
    const user = userEvent.setup();
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const links: string[] = [];
    renderPortal("/messages", {
      as: PEOPLE.farah,
      backend: withChannel(["chat.use"]),
      wrap: (client) => ({
        ...client,
        getChatAttachmentDownloadLink: (id, options) => {
          links.push(id);
          return client.getChatAttachmentDownloadLink(id, options);
        },
      }),
    });
    const log = await openEveryone(user);
    await user.upload(screen.getByLabelText("Choose a file to attach"), new File(["%PDF-1.4 synthetic"], "rota.pdf", { type: "application/pdf" }));
    await user.click(await screen.findByRole("button", { name: "Send without caption" }));
    expect((await within(log).findAllByText(/Sent a file: rota\.pdf/)).length).toBeGreaterThan(0);
    const files = await screen.findByRole("list", { name: "Files in this chat" });
    expect(files.textContent).toContain("rota.pdf");
    await user.click(within(files).getByRole("button", { name: "Download rota.pdf" }));
    await waitFor(() => {
      expect(open).toHaveBeenCalledOnce();
    });
    expect(links).toHaveLength(1);
    expect(String(open.mock.calls[0]?.[0])).toMatch(/\/chat-attachments\/.+\/content/);
    open.mockRestore();
  });

  it("sends what is typed as the caption of a chosen file, and a removed file is not sent", async () => {
    const user = userEvent.setup();
    const forms: FormData[] = [];
    renderPortal("/messages", {
      as: PEOPLE.farah,
      backend: withChannel(["chat.use"]),
      wrap: (client) => ({
        ...client,
        postChatAttachment: (id, form, options) => {
          forms.push(form);
          return client.postChatAttachment(id, form, options);
        },
      }),
    });
    const log = await openEveryone(user);
    const input = screen.getByLabelText("Choose a file to attach");
    await user.upload(input, new File(["%PDF-1.4"], "old.pdf", { type: "application/pdf" }));
    await user.click(await screen.findByRole("button", { name: "Remove old.pdf" }));
    expect(screen.queryByRole("button", { name: "Send without caption" })).toBeNull();
    await user.upload(input, new File(["%PDF-1.4 synthetic"], "rota.pdf", { type: "application/pdf" }));
    expect(await screen.findByText(/rota\.pdf \(/)).toBeTruthy();
    await user.type(screen.getByLabelText("Message Everyone"), "Monday rota");
    await user.click(screen.getByRole("button", { name: "Send message" }));
    expect((await within(log).findAllByText("Sent a file: rota.pdf. Monday rota")).length).toBeGreaterThan(0);
    expect(forms).toHaveLength(1);
    expect(forms[0]?.get("body")).toBe("Monday rota");
    expect(screen.queryByRole("button", { name: "Send without caption" })).toBeNull();
  });

  it("refuses a file that isn't an image or PDF before sending it", async () => {
    const user = userEvent.setup({ applyAccept: false });
    const post = vi.fn();
    renderPortal("/messages", {
      as: PEOPLE.farah,
      backend: withChannel(["chat.use"]),
      wrap: (client) => ({
        ...client,
        postChatAttachment: (id, form, options) => {
          post();
          return client.postChatAttachment(id, form, options);
        },
      }),
    });
    await openEveryone(user);
    await user.upload(screen.getByLabelText("Choose a file to attach"), new File(["x"], "notes.txt", { type: "text/plain" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Attach a JPEG, PNG or PDF file.");
    expect(post).not.toHaveBeenCalled();
  });

  it("still skips polling while the tab is hidden", async () => {
    const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const seen: number[] = [];
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    renderPortal("/messages", {
      as: PEOPLE.farah,
      backend: withChannel(["chat.use"]),
      wrap: (client) => ({
        ...client,
        listChatMessages: (id, query, options) => {
          seen.push(Date.now());
          return client.listChatMessages(id, query, options);
        },
      }),
    });
    await openEveryone(user);
    const first = seen.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(seen).toHaveLength(first);
    visibility.mockRestore();
  });

  it("has no axe violations on the channel with a notice and a file", async () => {
    const user = userEvent.setup();
    const backend = withChannel();
    await asAsha(backend).postChatMessage(CHANNEL_ID, { body: "Welcome", client_id: "a-1", is_notice: true });
    renderPortal("/messages", { as: PEOPLE.asha, backend });
    await user.click(await screen.findByRole("button", { name: "Staff chat" }));
    await openEveryone(user);
    await screen.findByText(/Pinned notice/);
    await user.upload(screen.getByLabelText("Choose a file to attach"), new File(["%PDF-1.4"], "plan.pdf", { type: "application/pdf" }));
    await screen.findByRole("button", { name: "Send without caption" });
    expect(problems(await axe.run(document.body, AXE))).toEqual([]);
    await user.click(screen.getByRole("button", { name: "Send without caption" }));
    await screen.findByRole("list", { name: "Files in this chat" });
    expect(problems(await axe.run(document.body, AXE))).toEqual([]);
  });
});

describe("Messages to patients: this month's numbers", () => {
  const STATS: MessageStats = {
    since: "2026-10-01T00:00:00.000Z",
    sent: 40,
    delivered: 30,
    failed: 2,
    skipped: 3,
    opt_outs: 1,
    delivered_pct: 75,
    by_channel: [],
  };
  const ok = (value: MessageStats) => ({ ok: true as const, value });
  const withStats = (reply: () => ReturnType<ApiClient["getMessageStats"]>) => (client: ApiClient): ApiClient => ({ ...client, getMessageStats: reply });

  it("shows sent, delivered with its share, failed or skipped, and opt-outs", async () => {
    renderPortal("/messages", { as: PEOPLE.asha, wrap: withStats(() => Promise.resolve(ok(STATS))) });
    const tiles = await screen.findByLabelText("Messages this month");
    expect(tiles.textContent).toMatch(/Sent\s*40/);
    expect(tiles.textContent).toContain("30 (75%)");
    expect(tiles.textContent).toMatch(/Failed or skipped\s*5/);
    expect(tiles.textContent).toMatch(/Opt-outs\s*1/);
    expect(problems(await axe.run(document.body, AXE))).toEqual([]);
  });

  it("says so while loading, when nothing was sent, and when the numbers can't be loaded", async () => {
    let release: () => void = () => undefined;
    renderPortal("/messages", {
      as: PEOPLE.asha,
      wrap: withStats(() => new Promise((resolve) => { release = () => { resolve(ok({ ...STATS, sent: 0, delivered: 0, failed: 0, skipped: 0, opt_outs: 0, delivered_pct: null })); }; })),
    });
    expect((await screen.findByText("Loading message numbers…")).getAttribute("role")).toBe("status");
    release();
    expect(await screen.findByText("No messages sent to patients yet this month.")).toBeTruthy();
    cleanup();

    renderPortal("/messages", { as: PEOPLE.asha, wrap: withStats(() => Promise.resolve(failure({ status: 500, code: "internal", message: "Numbers are down." }))) });
    expect((await screen.findByText(/Numbers are down\./)).getAttribute("role")).toBe("alert");
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
    expect(problems(await axe.run(document.body, AXE))).toEqual([]);
  });

  it("hides the numbers from a role that can't send messages", async () => {
    renderPortal("/messages", { as: PEOPLE.farah, backend: farahWith(["chat.use", "campaigns.manage"]) });
    await screen.findByRole("button", { name: "Staff chat" });
    expect(screen.queryByLabelText("Messages this month")).toBeNull();
  });
});

describe("What each role sees", () => {
  it("hides Offer and Staff chat from someone who may only message patients", async () => {
    renderPortal("/messages", { as: PEOPLE.farah, backend: farahWith(["messages.send", "patients.read"]) });
    await screen.findByRole("button", { name: "One patient" });
    expect(screen.getByRole("button", { name: "Broadcast" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Offer" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Staff chat" })).toBeNull();
    expect(screen.queryByLabelText("Offer results")).toBeNull();
  });

  it("shows only chat to someone with chat.use alone", async () => {
    renderPortal("/messages", { as: PEOPLE.farah, backend: farahWith(["chat.use"]) });
    await screen.findByRole("heading", { name: "Conversations" });
    expect(screen.queryByRole("button", { name: "Patients" })).toBeNull();
    expect(screen.queryByRole("button", { name: "One patient" })).toBeNull();
  });

  it("explains when the role can do neither", async () => {
    renderPortal("/messages", { as: PEOPLE.farah, backend: farahWith(["patients.read"]) });
    await screen.findByText("Messages aren't available to your role");
  });

  it("keeps the old stub when the New look is off", async () => {
    localStorage.setItem(NEW_LOOK_KEY, "0");
    renderPortal("/messages", { as: PEOPLE.asha });
    await screen.findByRole("heading", { name: "Recall campaign" });
  });
});

describe("Messages states", () => {
  it("says when the conversations can't be loaded and offers a retry", async () => {
    const wrap = (client: ApiClient): ApiClient => ({
      ...client,
      listConversations: () => Promise.resolve(failure({ status: 500, code: "internal", message: "Chat is down." })),
    });
    renderPortal("/messages", { as: PEOPLE.farah, backend: farahWith(["chat.use"]), wrap });
    await screen.findByText(/Chat is down\./);
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });
});

describe("Messages accessibility", () => {
  it("has no axe violations on the Patients tab, in each mode", async () => {
    const user = userEvent.setup();
    renderPortal("/messages", { as: PEOPLE.asha });
    await screen.findByRole("group", { name: "Patients" });
    await within(screen.getByRole("group", { name: "Patients" })).findAllByRole("button");
    await screen.findByLabelText("Template");
    expect(problems(await axe.run(document.body, AXE))).toEqual([]);
    await user.click(screen.getByRole("button", { name: "Broadcast" }));
    await screen.findByLabelText("Template");
    expect(problems(await axe.run(document.body, AXE))).toEqual([]);
    await user.click(screen.getByRole("button", { name: "Offer" }));
    await screen.findByLabelText("Offer text");
    expect(problems(await axe.run(document.body, AXE))).toEqual([]);
  });

  it("has no axe violations on Staff chat", async () => {
    const user = userEvent.setup();
    renderPortal("/messages", { as: PEOPLE.asha });
    await user.click(await screen.findByRole("button", { name: "Staff chat" }));
    await user.click(await screen.findByRole("button", { name: /General/ }));
    await within(await screen.findByRole("log", { name: "Messages in General" })).findByText(/Dussehra/);
    expect(problems(await axe.run(document.body, AXE))).toEqual([]);
    await user.click(screen.getByRole("button", { name: /New chat/ }));
    await screen.findByRole("form", { name: "New chat" });
    expect(problems(await axe.run(document.body, AXE))).toEqual([]);
  });
});
