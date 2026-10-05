/**
 * Development only: a sample clinic with a published website, so the designs can be tried
 * without an API. `?template=bold&palette=coral&layout=multi&fonts=editorial` picks a look.
 */

import type { ApiClient } from "@aarogyam/api-client";

const OWNER = "a1a1a1a1-0000-4000-8000-000000000001";
const HOST = "sunrise.localtest.me";

/** A soft gradient picture, so the layouts show how real photographs sit in them. */
function picture(hue: number, width = 800, height = 1000): Promise<File> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (context !== null) {
    const gradient = context.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, `hsl(${String(hue)} 55% 72%)`);
    gradient.addColorStop(1, `hsl(${String((hue + 50) % 360)} 50% 38%)`);
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, height);
    context.fillStyle = "rgba(255,255,255,.22)";
    context.beginPath();
    context.arc(width * 0.7, height * 0.3, width * 0.28, 0, Math.PI * 2);
    context.fill();
  }
  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      resolve(new File([blob ?? new Blob()], "sample.png", { type: "image/png" }));
    }, "image/png");
  });
}

export async function devSample(): Promise<ApiClient> {
  const { createFakeBackend, createFixtures, fakeTokenFor } = await import("@aarogyam/api-client/fake");
  const backend = createFakeBackend(createFixtures());
  const owner = backend.client({ host: HOST, getToken: () => fakeTokenFor({ id: OWNER }) });
  const params = new URLSearchParams(window.location.search);
  const upload = async (kind: string, hue: number, alt: string, size?: [number, number]) => {
    const form = new FormData();
    form.set("file", await picture(hue, ...(size ?? [])));
    form.set("kind", kind);
    form.set("alt", alt);
    await owner.uploadWebsitePhoto(form);
  };
  if (params.get("photos") !== "none") {
    await upload("hero", 190, "The reception at Sunrise Dental");
    await upload("about", 20, "A treatment room");
    await upload("logo", 200, "Sunrise Dental logo", [240, 240]);
    for (const [i, alt] of ["Waiting area", "Treatment chair", "Sterilisation room", "Our team", "Reception", "Smile wall"].entries()) {
      await upload("gallery", 30 + i * 55, alt, [800, i % 3 === 0 ? 1000 : 700]);
    }
  }
  const settings = await owner.getWebsiteSettings();
  const doctors = settings.ok ? settings.value.doctors : [];
  await owner.updateWebsite({
    published: true,
    layout: params.get("layout") === "multi" ? "multi" : "one",
    template: params.get("template") ?? "aurora",
    ...(params.get("palette") === null ? {} : { palette: params.get("palette") ?? "" }),
    fonts: params.get("fonts") ?? "modern",
    content: {
      hero: { headline: "", subheadline: "", cta_label: "" },
      about: { title: "", body: "", highlights: [] },
      doctors: doctors.map((d, i) => ({
        practitioner_id: d.id,
        qualifications: i === 0 ? "BDS, MDS (Orthodontics)" : "BDS, MDS",
        bio: i === 0 ? "Twelve years of straightening smiles, from children to grandparents." : "",
        photo_id: null,
        hidden: false,
      })),
      services: { intro: "", show_fees: true, hidden: [], notes: [] },
      reviews: [
        { name: "Priya N.", rating: 5, text: "Kind, quick and clear about the fees. I knew the cost before the treatment started." },
        { name: "Rahul S.", rating: 5, text: "My son was not scared at all. The whole team was patient with him." },
        { name: "Meera K.", rating: 4, text: "Easy to book online and the clinic is spotless." },
      ],
      contact: { whatsapp: "9876543210", email: "hello@sunrise.example", map_url: "", hours_note: "Closed on public holidays" },
      social: { instagram: "https://instagram.com/sunrise", facebook: "https://facebook.com/sunrise", youtube: "" },
      seo: { title: "", description: "" },
    },
  });
  return backend.client({ host: HOST, getToken: () => null });
}
