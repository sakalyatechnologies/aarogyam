import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { fakeTokenFor } from "@aarogyam/api-client/fake";
import { TEMPLATES } from "@aarogyam/site-kit";

import { PEOPLE, fakeApi, renderPortal } from "../../../test/render.js";

const SUNRISE = "sunrise.localtest.me";

async function openWebsite(backend = fakeApi(), as: string = PEOPLE.asha) {
  const user = userEvent.setup();
  renderPortal("/settings", { as, backend });
  await user.click(await screen.findByRole("tab", { name: "Website" }));
  await screen.findByRole("heading", { name: /Your website/ });
  return { user, backend };
}

/** The site inside the preview frame, apart from the portal's own navigation. */
const sitePreview = (): HTMLElement => {
  const root = document.querySelector<HTMLElement>(".cs-root");
  if (root === null) throw new Error("no preview");
  return root;
};

const owner = (backend: ReturnType<typeof fakeApi>) => backend.client({ host: SUNRISE, getToken: () => fakeTokenFor({ id: PEOPLE.asha }) });

describe("Settings, Website", () => {
  it("is for people who manage settings", async () => {
    renderPortal("/settings", { as: PEOPLE.farah });
    expect(await screen.findByRole("tab", { name: "Sessions" })).toBeTruthy();
    expect(screen.queryByRole("tab", { name: "Website" })).toBeNull();
  });

  it("shows a live preview of the clinic's own data, and gallery of designs with thumbnails", async () => {
    await openWebsite();
    expect((await screen.findByRole("textbox", { name: "Headline" })).textContent).toBe("Healthy smiles, gently cared for");
    // The clinic's name and price list fill the page.
    expect(document.querySelector(".cs-t-aurora")).not.toBeNull();
    expect(screen.getAllByText("Sunrise Dental").length).toBeGreaterThan(0);
    for (const template of TEMPLATES) {
      expect(screen.getByRole("img", { name: `${template.name} design` })).toBeTruthy();
    }
    expect(TEMPLATES.map((t) => t.name)).toEqual(expect.arrayContaining(["Heritage", "Smile Bright", "Peach Bento", "Pistachio Bento", "Midnight Bento"]));
  });

  it("offers every design in the catalogue and saves the ones the API lists, with their own colours", async () => {
    const { user, backend } = await openWebsite();
    const listed = await owner(backend).getWebsiteSettings();
    expect(listed.ok && listed.value.templates.map((t) => [t.id, t.palettes])).toEqual(TEMPLATES.map((t) => [t.id, t.palettes.map((p) => p.id)]));
    await user.click(await screen.findByRole("button", { name: /Peach Bento design/ }));
    await waitFor(() => {
      expect(document.querySelector(".cs-t-bentopeach")).not.toBeNull();
    });
    expect(document.querySelector(".cs-root")?.getAttribute("data-palette")).toBe("peach");
    expect(screen.getByRole("button", { name: "Rose colours" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Rose colours" }));
    await waitFor(async () => {
      const saved = await owner(backend).getWebsiteSettings();
      expect(saved.ok && [saved.value.template, saved.value.palette]).toEqual(["bentopeach", "rose"]);
    });
  });

  it("changes the design, palette and layout, saving each and showing it at once", async () => {
    const { user, backend } = await openWebsite();
    await user.click(await screen.findByRole("button", { name: /Bold design/ }));
    await waitFor(() => {
      expect(document.querySelector(".cs-t-bold")).not.toBeNull();
    });
    await user.click(screen.getByRole("button", { name: "Coral colours" }));
    await waitFor(() => {
      expect(document.querySelector(".cs-root")?.getAttribute("data-palette")).toBe("coral");
    });
    await user.click(screen.getByRole("radio", { name: /Several pages/ }));
    await waitFor(() => {
      expect(within(sitePreview()).getByRole("link", { name: "Home" })).toBeTruthy();
    });
    await waitFor(async () => {
      const saved = await owner(backend).getWebsiteSettings();
      expect(saved.ok && [saved.value.template, saved.value.palette, saved.value.layout]).toEqual(["bold", "coral", "multi"]);
    });
  });

  it("edits text in place and keeps it", async () => {
    const { backend } = await openWebsite();
    const headline = await screen.findByRole("textbox", { name: "Headline" });
    headline.textContent = "Smiles for every age";
    fireEvent.blur(headline);
    await waitFor(async () => {
      const saved = await owner(backend).getWebsiteSettings();
      expect(saved.ok && saved.value.content.hero.headline).toBe("Smiles for every age");
    });
    expect(screen.getByRole("textbox", { name: "Headline" }).textContent).toBe("Smiles for every age");
  });

  it("previews on a phone-sized screen", async () => {
    const { user } = await openWebsite();
    await user.click(await screen.findByRole("button", { name: "Phone" }));
    expect(document.querySelector(".wb-frame.is-phone")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Phone" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("publishes and takes the site down", async () => {
    const { user, backend } = await openWebsite();
    const visitor = backend.client({ host: SUNRISE, getToken: () => null });
    expect((await visitor.getPublicSite()).ok).toBe(false);
    await user.click(await screen.findByRole("button", { name: "Publish" }));
    expect(await screen.findByRole("button", { name: "Take down" })).toBeTruthy();
    expect((await visitor.getPublicSite()).ok).toBe(true);
    // The real address and its status show, not a placeholder.
    const open = await screen.findByRole("link", { name: "Open sunrise-site.spring-snow-130f.workers.dev" });
    expect(open.getAttribute("href")).toBe("https://sunrise-site.spring-snow-130f.workers.dev");
    expect(screen.getByText(/Address ready/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Take down" }));
    expect(await screen.findByRole("button", { name: "Publish" })).toBeTruthy();
    expect(screen.queryByText(/Address ready/)).toBeNull();
    expect((await visitor.getPublicSite()).ok).toBe(false);
  });

  it("edits services, fees and doctors from the Content tab", async () => {
    const { user, backend } = await openWebsite();
    await user.click(await screen.findByRole("tab", { name: "Content" }));
    await user.click(await screen.findByRole("switch", { name: "Show fees" }));
    const saves = screen.getAllByRole("button", { name: "Save changes" });
    await user.click(saves[saves.length - 1] ?? saves[0] ?? document.body);
    await waitFor(async () => {
      const saved = await owner(backend).getWebsiteSettings();
      expect(saved.ok && saved.value.content.services.show_fees).toBe(false);
    });
  });

  it("walks through the custom domain step: records, a warning about MX, registrar tips, or the free address", async () => {
    const { user, backend } = await openWebsite();
    await user.click(await screen.findByRole("tab", { name: "Domain" }));
    // No domain yet: the free address from the configured template.
    expect(await screen.findByText("sunrise-site.spring-snow-130f.workers.dev")).toBeTruthy();
    await user.click(screen.getByRole("radio", { name: /Yes, I have one/ }));
    await user.type(screen.getByLabelText("Your domain"), "https://www.SunriseDental.in/");
    await user.click(screen.getByRole("button", { name: "Show me the records" }));
    const table = await screen.findByRole("table", { name: /DNS records to add for www.sunrisedental.in/ });
    expect(within(table).getByText("CNAME")).toBeTruthy();
    expect(within(table).getByText("aarogyam-site.spring-snow-130f.workers.dev")).toBeTruthy();
    expect(within(table).getByText("TXT")).toBeTruthy();
    expect(within(table).getByText("_aarogyam-verify")).toBeTruthy();
    expect(within(table).getByText(/^aarogyam-verify-/)).toBeTruthy();
    expect(screen.getByRole("note").textContent).toMatch(/Do not change your MX records/);
    expect(screen.getByText("Waiting for your records")).toBeTruthy();
    for (const registrar of ["GoDaddy", "Hostinger", "BigRock", "Namecheap"]) {
      expect(screen.getByText(registrar)).toBeTruthy();
    }
    await waitFor(async () => {
      const saved = await owner(backend).getWebsiteSettings();
      expect(saved.ok && saved.value.domain.custom_domain).toBe("www.sunrisedental.in");
    });
    await user.click(screen.getByRole("button", { name: "Remove this domain" }));
    await waitFor(() => {
      expect(screen.queryByRole("table")).toBeNull();
    });
  });

  it("refuses a domain the API rejects, saying why", async () => {
    const { user } = await openWebsite();
    await user.click(await screen.findByRole("tab", { name: "Domain" }));
    await user.click(await screen.findByRole("radio", { name: /Yes, I have one/ }));
    await user.type(screen.getByLabelText("Your domain"), "not a domain");
    await user.click(screen.getByRole("button", { name: "Show me the records" }));
    expect((await screen.findAllByText(/domain name/i)).length).toBeGreaterThan(0);
    expect(screen.queryByRole("table")).toBeNull();
  });
});
