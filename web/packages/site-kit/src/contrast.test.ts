import { describe, expect, it } from "vitest";

import { TEMPLATES } from "./catalog.js";

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}

describe("palettes meet WCAG AA", () => {
  it("has at least nine designs with at least three palettes each", () => {
    expect(TEMPLATES.length).toBeGreaterThanOrEqual(9);
    for (const template of TEMPLATES) {
      expect(template.palettes.length).toBeGreaterThanOrEqual(3);
    }
  });

  for (const template of TEMPLATES) {
    for (const p of template.palettes) {
      it(`${template.id} / ${p.id}`, () => {
        const pairs: [string, string, string][] = [
          ["text on bg", p.text, p.bg],
          ["text on surface", p.text, p.surface],
          ["text on surface2", p.text, p.surface2],
          ["muted on bg", p.muted, p.bg],
          ["muted on surface", p.muted, p.surface],
          ["muted on surface2", p.muted, p.surface2],
          ["button text on accent", p.onAccent, p.accent],
          ["accent text on bg", p.accentText, p.bg],
          ["accent text on surface", p.accentText, p.surface],
          ["accent text on surface2", p.accentText, p.surface2],
        ];
        for (const [what, fg, bg] of pairs) {
          expect(contrast(fg, bg), `${what}: ${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
        }
      });
    }
  }
});
