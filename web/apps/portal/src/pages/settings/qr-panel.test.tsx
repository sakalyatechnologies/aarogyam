import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { fakeTokenFor } from "@aarogyam/api-client/fake";

import { NOW, PEOPLE, fakeApi, renderPortal } from "../../test/render.js";

const SUNRISE = "sunrise.localtest.me";

const keyOf = (url: string | null | undefined): string => new URL(url ?? "").searchParams.get("k") ?? "";

describe("Settings: Patient QR", () => {
  it("turns the QR on, shows it, and retires old posters on New QR", async () => {
    const user = userEvent.setup();
    const backend = fakeApi();
    const owner = backend.client({ host: SUNRISE, getToken: () => fakeTokenFor({ id: PEOPLE.asha }), now: () => NOW });
    const visitor = backend.client({ host: SUNRISE, now: () => NOW });
    renderPortal("/settings?tab=qr", { as: PEOPLE.asha, backend });

    const toggle = await screen.findByRole("switch", { name: "Patient check-in by QR" });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(screen.queryByRole("button", { name: "Print poster" })).toBeNull();
    await user.click(toggle);

    expect((await screen.findAllByRole("img", { name: "QR code for patient check-in" })).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Print poster" })).toBeTruthy();
    const first = await owner.getSelfCheckInSettings();
    if (!first.ok) throw new Error("expected settings");
    const oldKey = keyOf(first.value.url);
    expect((await visitor.getArrivePage(oldKey)).ok).toBe(true);

    await user.click(screen.getByRole("button", { name: "New QR" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/stop working/)).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "Make a new QR" }));

    await waitFor(async () => { expect((await visitor.getArrivePage(oldKey)).ok).toBe(false); });
    const second = await owner.getSelfCheckInSettings();
    if (!second.ok) throw new Error("expected settings");
    expect(keyOf(second.value.url)).not.toBe(oldKey);
  });

  it("turns it off again", async () => {
    const user = userEvent.setup();
    const backend = fakeApi();
    renderPortal("/settings?tab=qr", { as: PEOPLE.asha, backend });
    const toggle = await screen.findByRole("switch", { name: "Patient check-in by QR" });
    await user.click(toggle);
    await screen.findByRole("button", { name: "Print poster" });
    await user.click(screen.getByRole("switch", { name: "Patient check-in by QR" }));
    await waitFor(() => { expect(screen.queryByRole("button", { name: "Print poster" })).toBeNull(); });
  });
});
