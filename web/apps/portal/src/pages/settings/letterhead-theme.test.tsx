import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { fakeTokenFor } from "@aarogyam/api-client/fake";

import { NOW, PEOPLE, fakeApi, renderPortal } from "../../test/render.js";

const SUNRISE = "sunrise.localtest.me";

function owner(backend: ReturnType<typeof fakeApi>) {
  return backend.client({ host: SUNRISE, getToken: () => fakeTokenFor({ id: PEOPLE.asha }), now: () => NOW });
}

/** The card for one tab, opened by its link: `/settings?tab=theme` or `/settings?tab=letterhead`. */
async function card(name: "Theme" | "Letterhead", ready: () => Promise<unknown>) {
  const heading = await screen.findByRole("heading", { name });
  const section = heading.closest("section");
  if (section === null) throw new Error(`expected the ${name} card`);
  await ready();
  return section;
}

const theme = () => card("Theme", () => screen.findByRole("radiogroup", { name: "Palette" }));
const letterhead = () => card("Letterhead", () => screen.findByRole("figure", { name: "Letterhead preview" }));

describe("Settings: Theme and Letterhead tabs", () => {
  it("switches the portal's palette and mode at once and saves it", async () => {
    const user = userEvent.setup();
    const backend = fakeApi();
    renderPortal("/settings?tab=theme", { as: PEOPLE.asha, backend });
    const card = await theme();
    await user.click(await within(card).findByRole("radio", { name: "Ocean, dark" }));

    // Saved for the clinic...
    const client = owner(backend);
    await screen.findByRole("radio", { name: "Ocean, dark", checked: true });
    const settings = await client.getClinicSettings();
    if (!settings.ok) throw new Error("expected settings");
    expect(settings.value.branding).toMatchObject({ brand: "#2563EB", mode: "dark" });
    // ...and applied to the portal's session, which the theme is read from.
    const session = await client.getSession();
    if (!session.ok) throw new Error("expected the session");
    expect(session.value.clinic.branding).toMatchObject({ brand: "#2563EB", mode: "dark" });

    // Switch back any time.
    await user.click(within(card).getByRole("radio", { name: "Mint, light" }));
    await screen.findByRole("radio", { name: "Mint, light", checked: true });
  });

  it("uses a custom brand colour", async () => {
    const user = userEvent.setup();
    const backend = fakeApi();
    renderPortal("/settings?tab=theme", { as: PEOPLE.asha, backend });
    const card = await theme();
    const hex = await within(card).findByLabelText(/Custom brand colour/);
    await user.clear(hex);
    await user.type(hex, "#7C3AED");
    await user.keyboard("{Enter}");
    const settings = await owner(backend).getClinicSettings();
    if (!settings.ok) throw new Error("expected settings");
    await screen.findByLabelText("Custom brand colour (in use)");
    expect(settings.value.branding.brand).toBe("#7C3AED");
  });

  it("previews a design live on a sample prescription, then saves it with a footer", async () => {
    const user = userEvent.setup();
    const backend = fakeApi();
    renderPortal("/settings?tab=letterhead", { as: PEOPLE.asha, backend });
    const card = await letterhead();
    const preview = await within(card).findByRole("figure", { name: "Letterhead preview" });
    expect(within(preview).getByText("Sample Patient")).toBeTruthy();

    await user.click(within(card).getByRole("radio", { name: "Modern band" }));
    await user.type(within(card).getByLabelText("Footer line"), "Open Mon to Sat");
    // Not saved yet, but already on the preview.
    expect(within(preview).getByText("Open Mon to Sat")).toBeTruthy();
    const before = await owner(backend).getClinicSettings();
    if (!before.ok) throw new Error("expected settings");
    expect(before.value.letterhead.template).toBe("classic");

    await user.click(within(card).getByRole("button", { name: "Save letterhead" }));
    expect(await screen.findByText("Letterhead saved")).toBeTruthy();
    const after = await owner(backend).getClinicSettings();
    if (!after.ok) throw new Error("expected settings");
    expect(after.value.letterhead).toMatchObject({ template: "modern_band", footer: "Open Mon to Sat" });
  });

  it("shows the API's message beside the field it refused", async () => {
    const user = userEvent.setup();
    renderPortal("/settings?tab=letterhead", { as: PEOPLE.asha });
    const card = await letterhead();
    await user.type(within(card).getByLabelText("Clinic e-mail"), "nobody");
    await user.click(within(card).getByRole("button", { name: "Save letterhead" }));
    expect((await within(card).findByText(/email must be a valid email address/i)).textContent).toMatch(/email/i);
  });

  it("refuses a non-image upload before it leaves the browser", async () => {
    const user = userEvent.setup({ applyAccept: false });
    renderPortal("/settings?tab=letterhead", { as: PEOPLE.asha });
    const card = await letterhead();
    await user.click(within(card).getByRole("radio", { name: /My own letterhead/ }));
    await user.upload(within(card).getByLabelText("Letterhead image"), new File(["x"], "x.txt", { type: "text/plain" }));
    expect((await within(card).findByRole("alert")).textContent).toBe("Choose a PNG or JPG image.");
  });

  it("keeps the theme and the letterhead apart, each with its own save", async () => {
    renderPortal("/settings?tab=theme", { as: PEOPLE.asha });
    const card = await theme();
    expect(within(card).queryByRole("figure", { name: "Letterhead preview" })).toBeNull();
    expect(within(card).queryByRole("button", { name: "Save letterhead" })).toBeNull();
    cleanup();
    renderPortal("/settings?tab=letterhead", { as: PEOPLE.asha });
    const other = await letterhead();
    expect(within(other).queryByRole("radiogroup", { name: "Palette" })).toBeNull();
    expect(within(other).getByRole("button", { name: "Save letterhead" })).toBeTruthy();
  });

  it("is only for someone who can manage settings", async () => {
    renderPortal("/settings?tab=letterhead", { as: PEOPLE.farah });
    await screen.findByText("Only the clinic owner can change the clinic profile.");
    expect(screen.queryByRole("tab", { name: "Letterhead" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "Theme" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Letterhead" })).toBeNull();
  });
});
