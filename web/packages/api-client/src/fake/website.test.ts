import { describe, expect, it } from "vitest";

import { websiteSettings, type ApiClient, type ApiResult, type WebsiteContent } from "../index.js";
import { createFakeBackend, createFixtures, fakeTokenFor } from "./index.js";

const NOW = new Date("2026-10-03T05:30:00Z");
const SUNRISE = "sunrise.localtest.me";
const LOTUS = "lotus.localtest.me";
const ASHA = "a1a1a1a1-0000-4000-8000-000000000001";
const FARAH = "a1a1a1a1-0000-4000-8000-000000000003";
const BINA = "b1b1b1b1-0000-4000-8000-000000000001";

function setup() {
  const backend = createFakeBackend(createFixtures({ now: NOW }));
  const as = (who: string | null, host: string): ApiClient =>
    backend.client({ host, getToken: () => (who === null ? null : fakeTokenFor({ id: who })), now: () => NOW });
  return { as };
}

function value<T>(result: ApiResult<T>): T {
  if (!result.ok) {
    throw new Error(`expected success, got ${result.error.code}: ${result.error.message}`);
  }
  return result.value;
}

const errorOf = <T>(result: ApiResult<T>) => (result.ok ? undefined : result.error);

function content(patch: Partial<WebsiteContent> = {}): WebsiteContent {
  return {
    hero: { headline: "", subheadline: "", cta_label: "" },
    about: { title: "", body: "", highlights: [] },
    doctors: [],
    services: { intro: "", show_fees: true, hidden: [], notes: [] },
    reviews: [],
    contact: { whatsapp: "", email: "", map_url: "", hours_note: "" },
    social: { instagram: "", facebook: "", youtube: "" },
    seo: { title: "", description: "" },
    ...patch,
  };
}

describe("fake website API", () => {
  it("accepts the newer designs with their own palettes and refuses another design's palette", async () => {
    const { as } = setup();
    const owner = as(ASHA, SUNRISE);
    const bento = value(await owner.updateWebsite({ template: "bentomidnight", fonts: "display" }));
    expect(bento).toMatchObject({ template: "bentomidnight", palette: "midnight", fonts: "display" });
    const heritage = value(await owner.updateWebsite({ template: "heritage", palette: "burgundy", fonts: "classic" }));
    expect(heritage).toMatchObject({ template: "heritage", palette: "burgundy" });
    // `sky` exists, but belongs to Smile Bright and Clinical, not Heritage.
    const refused = await owner.updateWebsite({ template: "heritage", palette: "sky" });
    expect(refused.ok).toBe(false);
  });

  it("starts with defaults, builds the preview from clinic data, and publishes", async () => {
    const { as } = setup();
    const owner = as(ASHA, SUNRISE);
    const first = value(await owner.getWebsiteSettings());
    expect(first).toMatchObject({ layout: "one", template: "aurora", palette: "gold", published: false });
    expect(websiteSettings.safeParse(first).success).toBe(true);
    expect(first.preview.clinic.name).toBe("Sunrise Dental");
    expect(first.preview.services.length).toBeGreaterThan(0);
    expect(first.templates.map((t) => t.id)).toEqual(["aurora", "hearth", "clinical", "bold", "heritage", "smilebright", "bentopeach", "bentopistachio", "bentomidnight"]);
    expect(first.fonts_available).toEqual(["modern", "elegant", "friendly", "editorial", "classic", "display"]);
    expect((await as(null, SUNRISE).getPublicSite()).ok).toBe(false);

    const changed = value(await owner.updateWebsite({ template: "hearth", layout: "multi", published: true, content: content({ hero: { headline: "  Gentle   care ", subheadline: "", cta_label: "" } }) }));
    expect(changed).toMatchObject({ template: "hearth", palette: "terracotta", layout: "multi", published: true });
    expect(changed.content.hero.headline).toBe("Gentle care");
    const page = value(await as(null, SUNRISE).getPublicSite());
    expect(page.design).toMatchObject({ template: "hearth", layout: "multi" });
    expect(page.hero.headline).toBe("Gentle care");
  });

  it("checks designs, content, and permissions like the API", async () => {
    const { as } = setup();
    const owner = as(ASHA, SUNRISE);
    for (const [body, field] of [
      [{ palette: "sky" }, "palette"],
      [{ template: "nope" }, "template"],
      [{ custom_domain: "nope" }, "custom_domain"],
      [{ content: content({ contact: { whatsapp: "", email: "", map_url: "http://x.in", hours_note: "" } }) }, "content.contact.map_url"],
      [{ content: content({ reviews: [{ name: "A", rating: 7, text: "x" }] }) }, "content.reviews.rating"],
    ] as const) {
      const error = errorOf(await owner.updateWebsite(body));
      expect(error?.status, field).toBe(400);
    }
    expect(errorOf(await as(FARAH, SUNRISE).getWebsiteSettings())?.status).toBe(403);
    expect(errorOf(await as(BINA, SUNRISE).getWebsiteSettings())?.status).toBeGreaterThanOrEqual(403);
    // Lotus has its own, separate settings.
    value(await owner.updateWebsite({ template: "bold" }));
    expect(value(await as(BINA, LOTUS).getWebsiteSettings()).template).toBe("aurora");
  });

  it("handles the custom domain and pictures", async () => {
    const { as } = setup();
    const owner = as(ASHA, SUNRISE);
    const pending = value(await owner.updateWebsite({ custom_domain: "HTTPS://www.Sunrise.in/" }));
    expect(pending.domain).toMatchObject({ custom_domain: "www.sunrise.in", status: "pending" });
    expect(pending.domain.verification_token).toMatch(/^aarogyam-verify-/);
    expect(value(await owner.updateWebsite({ custom_domain: "" })).domain.status).toBe("none");

    const form = new FormData();
    form.set("file", new File([new Uint8Array([1, 2, 3])], "x.png", { type: "image/png" }));
    form.set("kind", "logo");
    const photo = value(await owner.uploadWebsitePhoto(form));
    expect(photo.kind).toBe("logo");
    expect(value(await owner.getWebsiteSettings()).preview.photos.logo?.id).toBe(photo.id);
    const bad = new FormData();
    bad.set("file", new File(["<svg/>"], "x.svg", { type: "image/svg+xml" }));
    expect(errorOf(await owner.uploadWebsitePhoto(bad))?.status).toBe(400);
    expect(value(await owner.describeWebsitePhoto(photo.id, { alt: "Our logo" })).alt).toBe("Our logo");
    value(await owner.deleteWebsitePhoto(photo.id));
    expect(errorOf(await owner.deleteWebsitePhoto(photo.id))?.status).toBe(404);
  });
});
