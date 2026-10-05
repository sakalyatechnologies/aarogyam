import { checkContrast, contrastRatio, hex, mix, PRESETS, type HexColor, type Theme, type ThemeMode } from "@sakalya/tokens";
import { describe, expect, it } from "vitest";

import css from "../mockup.css?raw";
import { avatarColour } from "../components/mk/index.js";
import { MOCKUP_BRAND, brandGradientEnd, mockupTheme } from "./mockup-theme.js";

const AA = 4.5;
const AA_UI = 3;
const WHITE = hex("#ffffff");

const BRANDS: readonly [string, HexColor][] = [["mockup", MOCKUP_BRAND], ...PRESETS.map((p): [string, HexColor] => [p.key, p.brand]), ["white", hex("#ffffff")], ["black", hex("#000000")], ["yellow", hex("#ffd400")], ["pale", hex("#cfe8dc")]];
const MODES: readonly ThemeMode[] = ["light", "dark"];

interface Pair {
  label: string;
  fg: HexColor;
  bg: HexColor;
  min: number;
}

/** The pairs the mock-up stylesheet puts text on: pages, cards, the drawer and dialogs, tables, chips, tags, the hero. */
function pairs(theme: Theme): Pair[] {
  const c = theme.colors;
  const ink2 = mix(c.text, c.surface, 0.82);
  const brand2 = brandGradientEnd(theme);
  const out: Pair[] = [
    { label: "text on page", fg: c.text, bg: c.background, min: AA },
    { label: "text on card, drawer, dialog, popover", fg: c.text, bg: c.surface, min: AA },
    { label: "secondary text on page", fg: c.textMuted, bg: c.background, min: AA },
    { label: "secondary text on card and drawer", fg: c.textMuted, bg: c.surface, min: AA },
    { label: "table body text (ink2) on card", fg: ink2, bg: c.surface, min: AA },
    { label: "chip: text on card", fg: ink2, bg: c.surface, min: AA },
    { label: "selected chip: card on ink", fg: c.surface, bg: c.text, min: AA },
    { label: "toast: card on ink", fg: c.surface, bg: c.text, min: AA },
    { label: "links and accent text on card", fg: c.primaryText, bg: c.surface, min: AA },
    { label: "accent tag on tint", fg: c.primaryText, bg: c.primarySoft, min: AA },
    { label: "button label on primary", fg: c.onPrimary, bg: c.primary, min: AA },
    { label: "hero and drawer header text on gradient start", fg: c.onPrimary, bg: brand2, min: AA },
    { label: "hero and drawer header text on gradient end", fg: c.onPrimary, bg: c.primary, min: AA },
    { label: "hero button: gradient colour on label colour", fg: brand2, bg: c.onPrimary, min: AA },
    { label: "NOW marker label", fg: c.onDanger, bg: c.danger, min: AA },
    { label: "buttons against cards", fg: c.primary, bg: c.surface, min: AA_UI },
    { label: "field outlines against cards", fg: c.borderStrong, bg: c.surface, min: AA_UI },
  ];
  for (const s of ["success", "warning", "danger", "info"] as const) {
    out.push({ label: `${s} tag text on tint`, fg: c[`${s}Text`], bg: c[`${s}Soft`], min: AA });
    out.push({ label: `${s} text on card`, fg: c[`${s}Text`], bg: c.surface, min: AA });
  }
  return out;
}

describe.each(BRANDS)("theme palette %s", (_name, brand) => {
  it.each(MODES)("is WCAG AA readable in %s mode", (mode) => {
    const theme = mockupTheme(brand, mode);
    const failures = pairs(theme)
      .map((p) => ({ ...p, ratio: contrastRatio(p.fg, p.bg) }))
      .filter((p) => p.ratio < p.min)
      .map((p) => `${p.label}: ${p.ratio.toFixed(2)} < ${String(p.min)}`);
    expect(failures).toEqual([]);
    const library = checkContrast(theme).filter((issue) => issue.tokens[0] !== "sidebarText" && issue.severity === "error");
    expect(library).toEqual([]);
  });
});

describe("avatars", () => {
  it("show white initials at AA on every avatar colour", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 400; i += 1) {
      seen.add(avatarColour(`patient ${String(i)}`));
    }
    for (const colour of seen) {
      expect(contrastRatio(WHITE, hex(colour)), colour).toBeGreaterThanOrEqual(AA);
    }
  });
});

describe("the mock-up stylesheet", () => {
  it("defines its colour variables for the drawer, scrim, toast and palette too, which render outside .mk-app", () => {
    const definition = css.split("}")[0] ?? "";
    expect(definition).toMatch(/\.mk-drawer/);
    expect(definition).toMatch(/\.mk-scrim/);
    expect(definition).toMatch(/\.mk-toast/);
    expect(definition).toMatch(/\.mk-palette/);
    expect(definition).toMatch(/--surface: var\(--sk-surface\)/);
    expect(definition).toMatch(/--ink: var\(--sk-text\)/);
  });

  it("puts no fixed white or pale text on the theme-coloured drawer header, hero or active menu", () => {
    const rules = css.split("\n").filter((line) => /^\.mk-(drawer-h|hero|eyebrow|hero-stats|nav a\[aria-current)/.test(line) && !line.includes("::before"));
    expect(rules.length).toBeGreaterThan(5);
    for (const rule of rules) {
      expect(rule, rule).not.toMatch(/[^-]color: #(fff|[cd][0-9a-f]{5})/i);
    }
  });
});
