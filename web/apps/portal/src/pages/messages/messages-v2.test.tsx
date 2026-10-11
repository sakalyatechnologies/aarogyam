import { act, cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { failure, type ApiClient, type Permission, type SendMessages } from "@aarogyam/api-client";
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
