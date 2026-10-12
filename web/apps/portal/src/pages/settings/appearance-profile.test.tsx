import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ApiClient, ProfileUpdate } from "@aarogyam/api-client";
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
  vi.restoreAllMocks();
  localStorage.clear();
});

const current = () => document.querySelector('.st-nl-nav [aria-current="page"]')?.textContent;

describe("My profile (new look)", () => {
  it("saves only what changed to PATCH /me, and says Saved", async () => {
    const calls: ProfileUpdate[] = [];
    const wrap = (client: ApiClient): ApiClient => ({
      ...client,
      updateMe: (changes, options) => {
        calls.push(changes);
        return client.updateMe(changes, options);
      },
    });
    const user = userEvent.setup();
    renderPortal("/settings", { as: PEOPLE.asha, wrap });
    const name = await screen.findByLabelText("Display name");
    expect(screen.getByRole("button", { name: "Save" }).hasAttribute("disabled")).toBe(true);
    await user.clear(name);
    await user.type(name, "Asha Rao");
    await user.clear(screen.getByLabelText("Phone"));
    await user.type(screen.getByLabelText("Phone"), "98765 43210");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText("Saved");
    expect(calls).toEqual([{ display_name: "Asha Rao", phone: "98765 43210" }]);
    // Saved: the form is clean again and the next save sends only the next change.
    await waitFor(() => { expect(screen.getByRole("button", { name: "Save" }).hasAttribute("disabled")).toBe(true); });
    await user.clear(screen.getByLabelText("Phone"));
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => { expect(calls).toHaveLength(2); });
    expect(calls[1]).toEqual({ phone: "" });
  });

  it("shows a message for an empty name and a bad phone, and sends nothing", async () => {
    const calls: ProfileUpdate[] = [];
    const wrap = (client: ApiClient): ApiClient => ({ ...client, updateMe: (changes, options) => { calls.push(changes); return client.updateMe(changes, options); } });
    const user = userEvent.setup();
    renderPortal("/settings", { as: PEOPLE.asha, wrap });
    const name = await screen.findByLabelText("Display name");
    await user.clear(name);
    await user.clear(screen.getByLabelText("Phone"));
    await user.type(screen.getByLabelText("Phone"), "12");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Enter your name.")).toBeTruthy();
    expect(screen.getByText(/Enter a valid phone number/)).toBeTruthy();
    expect(calls).toEqual([]);
  });

  it("saves a preset avatar with PUT /me/avatar and shows it on the session", async () => {
    const backend = fakeApi();
    const forms: FormData[] = [];
    const wrap = (client: ApiClient): ApiClient => ({ ...client, putMyAvatar: (form, options) => { forms.push(form); return client.putMyAvatar(form, options); } });
    const user = userEvent.setup();
    renderPortal("/settings", { as: PEOPLE.asha, backend, wrap });
    await user.click(await screen.findByRole("button", { name: "Avatar: Star" }));
    expect(screen.getByRole("button", { name: "Avatar: Star" }).getAttribute("aria-pressed")).toBe("true");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText("Saved");
    expect(forms.map((form) => form.get("preset"))).toEqual(["tooth_3"]);
    const api = backend.client({ host: SUNRISE, getToken: () => fakeTokenFor({ id: PEOPLE.asha }), now: () => NOW });
    const session = await api.getSession();
    expect(session.ok && session.value.user.avatar?.preset).toBe("tooth_3");
    await waitFor(() => { expect(screen.getByRole("button", { name: "Avatar: Star" }).getAttribute("aria-pressed")).toBe("true"); });
  });

  it("refuses a file that is not a PNG or JPEG before sending it", async () => {
    const user = userEvent.setup({ applyAccept: false });
    renderPortal("/settings", { as: PEOPLE.asha });
    await screen.findByLabelText("Display name");
    await user.upload(screen.getByLabelText("Photo file"), new File(["hi"], "me.txt", { type: "text/plain" }));
    expect(await screen.findByText("Choose a PNG or JPEG photo of at most 2 MB.")).toBeTruthy();
  });

  it("has no axe violations", async () => {
    renderPortal("/settings", { as: PEOPLE.asha });
    await screen.findByLabelText("Display name");
    expect(problems(await axe.run(document.body, AXE))).toEqual([]);
  });

  it("is the same editable form for a member who is not the owner", async () => {
    renderPortal("/settings", { as: PEOPLE.farah });
    expect(await screen.findByLabelText("Display name")).toBeTruthy();
    expect(current()).toBe("My profile");
  });
});

describe("Appearance (new look)", () => {
  it("?tab=theme opens Appearance at the clinic theme, for the owner", async () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    renderPortal("/settings?tab=theme", { as: PEOPLE.asha });
    expect(await screen.findByRole("heading", { name: "Clinic theme" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "My dashboard" })).toBeTruthy();
    await screen.findByRole("radiogroup", { name: "Palette" });
    expect(current()).toBe("Appearance");
    expect(scroll.mock.contexts.some((el) => el instanceof HTMLElement && el.id === "appearance-theme")).toBe(true);
  });

  it("?tab=studio opens Appearance at My dashboard", async () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    renderPortal("/settings?tab=studio", { as: PEOPLE.asha });
    expect(await screen.findByRole("group", { name: "Live preview of Today" })).toBeTruthy();
    expect(current()).toBe("Appearance");
    expect(scroll.mock.contexts.some((el) => el instanceof HTMLElement && el.id === "appearance-studio")).toBe(true);
  });

  it("is My dashboard alone for a member who cannot manage settings, even on ?tab=theme", async () => {
    renderPortal("/settings?tab=theme", { as: PEOPLE.farah });
    expect(await screen.findByRole("group", { name: "Live preview of Today" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Clinic theme" })).toBeNull();
    expect(screen.queryByRole("radiogroup", { name: "Palette" })).toBeNull();
    expect(current()).toBe("Appearance");
  });

  it("is one tab: the left nav has Appearance and no Theme or Dashboard studio", async () => {
    renderPortal("/settings", { as: PEOPLE.asha });
    const nav = await screen.findByRole("navigation", { name: "Settings sections" });
    expect(within(nav).getByRole("button", { name: "Appearance" })).toBeTruthy();
    expect(within(nav).queryByRole("button", { name: "Theme" })).toBeNull();
    expect(within(nav).queryByRole("button", { name: "Dashboard studio" })).toBeNull();
  });

  it("has no axe violations", async () => {
    renderPortal("/settings?tab=appearance", { as: PEOPLE.asha });
    await screen.findByRole("group", { name: "Live preview of Today" });
    await screen.findByRole("radiogroup", { name: "Palette" });
    expect(problems(await axe.run(document.body, AXE))).toEqual([]);
  });
});

describe("the prescription footer", () => {
  it("is edited in Letterhead only in the new look, and Clinic profile leaves it alone when it saves", async () => {
    const backend = fakeApi();
    const sent: Record<string, unknown>[] = [];
    const wrap = (client: ApiClient): ApiClient => ({ ...client, updateClinicSettings: (changes, options) => { sent.push({ ...changes }); return client.updateClinicSettings(changes, options); } });
    const user = userEvent.setup();
    renderPortal("/settings?tab=profile", { as: PEOPLE.asha, backend, wrap });
    await screen.findByRole("group", { name: "Identity" });
    expect(screen.queryByLabelText("Prescription footer")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => { expect(sent).toHaveLength(1); });
    expect("prescription_footer" in (sent[0] ?? {})).toBe(false);
    cleanup();
    renderPortal("/settings?tab=letterhead", { as: PEOPLE.asha, backend });
    expect(await screen.findByLabelText("Footer line")).toBeTruthy();
  });

  it("stays in Clinic profile in the old look", async () => {
    localStorage.setItem(NEW_LOOK_KEY, "0");
    renderPortal("/settings?tab=profile", { as: PEOPLE.asha });
    expect(await screen.findByLabelText("Prescription footer")).toBeTruthy();
  });
});

describe("Chairs & doctors (new look)", () => {
  it("puts Chairs and Doctors in one row from 1100px, and leave below at full width", async () => {
    const css = (await import("./settings.css?raw")).default;
    expect(css).toMatch(/@media \(min-width: 1100px\) \{\s*\.st-nl \.st-cd-pair \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
    renderPortal("/settings?tab=chairs-doctors", { as: PEOPLE.asha });
    await screen.findByRole("heading", { name: "Upcoming leave" });
    const pair = document.querySelector<HTMLElement>(".st-cd-pair");
    if (pair === null) throw new Error("no Chairs and Doctors row");
    expect(pair.children).toHaveLength(2);
    expect(within(pair).queryByRole("heading", { name: "Upcoming leave" })).toBeNull();
    expect(within(pair).getByRole("heading", { name: "Doctors" })).toBeTruthy();
  });
});
