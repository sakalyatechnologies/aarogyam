import { describe, expect, it } from "vitest";

import { slugify } from "./slug.js";

describe("slugify", () => {
  it.each([
    ["Smile Catchers", "smile-catchers"],
    ["Dr. Mehta's Dental & Implant Centre", "dr-mehtas-dental-implant"],
    ["  Dantashree   Dental--Clinic ", "dantashree-dental-clinic"],
    ["Clínica Dentária São José", "clinica-dentaria-sao-jose"],
    ["32 Pearls", "32-pearls"],
  ])("%s → %s", (name, slug) => {
    expect(slugify(name)).toBe(slug);
  });

  it("never exceeds 30 characters or ends with a hyphen", () => {
    const slug = slugify("A Very Long Multispeciality Dental Hospital And Research Centre");
    expect(slug.length).toBeLessThanOrEqual(30);
    expect(slug.endsWith("-")).toBe(false);
  });
});
