/** The designs, palettes and font pairings a clinic can choose. The API checks the same ids. */

export type TemplateId = "aurora" | "hearth" | "clinical" | "bold";

/** Colours of one palette, applied as CSS variables on the site's root element. */
export interface Palette {
  id: string;
  name: string;
  /** Page background. */
  bg: string;
  /** Cards and panels. */
  surface: string;
  /** A second surface, for bands and hover states. */
  surface2: string;
  /** Body text. */
  text: string;
  /** Secondary text. */
  muted: string;
  /** Hairlines and borders. */
  line: string;
  /** Buttons, markers and large display accents. */
  accent: string;
  /** Text on `accent`. */
  onAccent: string;
  /** The accent as text or a link on `bg` and `surface`. */
  accentText: string;
}

export interface TemplateInfo {
  id: TemplateId;
  name: string;
  tagline: string;
  palettes: Palette[];
}

export const TEMPLATES: readonly TemplateInfo[] = [
  {
    id: "aurora",
    name: "Aurora",
    tagline: "Premium dark. Deep tones, soft glow, an elegant first impression.",
    palettes: [
      { id: "gold", name: "Gold", bg: "#0d0f12", surface: "#161a20", surface2: "#1d222a", text: "#f4f1ea", muted: "#b0b6bf", line: "#2a303a", accent: "#d4af37", onAccent: "#1a1405", accentText: "#e3c15a" },
      { id: "emerald", name: "Emerald", bg: "#07120f", surface: "#0f1c18", surface2: "#162621", text: "#eef6f2", muted: "#a5b8b0", line: "#233630", accent: "#34d399", onAccent: "#04241a", accentText: "#6ee7b7" },
      { id: "sapphire", name: "Sapphire", bg: "#090e1c", surface: "#111a2f", surface2: "#18233d", text: "#eef2fb", muted: "#a8b3cc", line: "#25314d", accent: "#60a5fa", onAccent: "#07182f", accentText: "#93c5fd" },
      { id: "amethyst", name: "Amethyst", bg: "#100b1a", surface: "#1a1328", surface2: "#241b37", text: "#f5effb", muted: "#bbaecb", line: "#32264a", accent: "#c084fc", onAccent: "#1e0b33", accentText: "#d8b4fe" },
    ],
  },
  {
    id: "hearth",
    name: "Hearth",
    tagline: "Warm and family friendly. Soft shapes, gentle colour, easy to trust.",
    palettes: [
      { id: "terracotta", name: "Terracotta", bg: "#fff8f0", surface: "#ffffff", surface2: "#fdeee0", text: "#3b2a20", muted: "#6b564a", line: "#ecd9c8", accent: "#b84a2f", onAccent: "#ffffff", accentText: "#a13e25" },
      { id: "sage", name: "Sage", bg: "#f6f8f2", surface: "#ffffff", surface2: "#e9f0e4", text: "#1f2f25", muted: "#4f6356", line: "#d5e0cf", accent: "#3f7a58", onAccent: "#ffffff", accentText: "#34684a" },
      { id: "honey", name: "Honey", bg: "#fffaf0", surface: "#ffffff", surface2: "#fdf0d2", text: "#33280f", muted: "#66573a", line: "#f0e0b8", accent: "#f0b429", onAccent: "#33280f", accentText: "#7a5200" },
      { id: "berry", name: "Berry", bg: "#fff7f9", surface: "#ffffff", surface2: "#fde8ef", text: "#3a1f2b", muted: "#6b4756", line: "#f3d3de", accent: "#b03a63", onAccent: "#ffffff", accentText: "#94294e" },
    ],
  },
  {
    id: "clinical",
    name: "Clinical",
    tagline: "Clean and minimal. White space, fine lines, clear information.",
    palettes: [
      { id: "sky", name: "Sky", bg: "#ffffff", surface: "#f5f8fb", surface2: "#eaf1f8", text: "#0f1f2e", muted: "#4b5d6e", line: "#dbe4ed", accent: "#0b6fba", onAccent: "#ffffff", accentText: "#0b6fba" },
      { id: "mint", name: "Mint", bg: "#ffffff", surface: "#f3f9f7", surface2: "#e5f3ef", text: "#0e2420", muted: "#46605a", line: "#d3e6e0", accent: "#0c7a5f", onAccent: "#ffffff", accentText: "#0c7a5f" },
      { id: "slate", name: "Slate", bg: "#ffffff", surface: "#f6f7f9", surface2: "#eceef2", text: "#141a22", muted: "#505a68", line: "#dfe3e9", accent: "#334155", onAccent: "#ffffff", accentText: "#334155" },
      { id: "indigo", name: "Indigo", bg: "#ffffff", surface: "#f6f6fd", surface2: "#ececfb", text: "#14132b", muted: "#52507a", line: "#e0dff4", accent: "#4f46e5", onAccent: "#ffffff", accentText: "#4338ca" },
    ],
  },
  {
    id: "bold",
    name: "Bold",
    tagline: "Big type, strong colour blocks. Modern, confident, hard to miss.",
    palettes: [
      { id: "electric", name: "Electric", bg: "#ffffff", surface: "#f4f4ff", surface2: "#e7e8ff", text: "#0a0a14", muted: "#4a4a5e", line: "#0a0a14", accent: "#2f3cff", onAccent: "#ffffff", accentText: "#2530d6" },
      { id: "coral", name: "Coral", bg: "#fffaf8", surface: "#fff0ec", surface2: "#ffe0d8", text: "#150b09", muted: "#5c4540", line: "#150b09", accent: "#ff6a57", onAccent: "#150b09", accentText: "#b32a18" },
      { id: "lime", name: "Lime", bg: "#fbfdf4", surface: "#f1f8dc", surface2: "#e4f2b8", text: "#0e1405", muted: "#4a5538", line: "#0e1405", accent: "#c6f432", onAccent: "#0e1405", accentText: "#3d5a00" },
      { id: "violet", name: "Violet", bg: "#fcfaff", surface: "#f3edff", surface2: "#e6dbff", text: "#140a26", muted: "#524468", line: "#140a26", accent: "#7c3aed", onAccent: "#ffffff", accentText: "#6a28d9" },
    ],
  },
];

export const DEFAULT_TEMPLATE: TemplateId = "aurora";

export function templateInfo(id: string): TemplateInfo {
  return TEMPLATES.find((t) => t.id === id) ?? firstTemplate();
}

function firstTemplate(): TemplateInfo {
  const [first] = TEMPLATES;
  if (first === undefined) {
    throw new Error("no designs");
  }
  return first;
}

/** The palette of a design; falls back to the design's first palette. */
export function paletteOf(template: string, palette: string): Palette {
  const info = templateInfo(template);
  const found = info.palettes.find((p) => p.id === palette);
  if (found !== undefined) {
    return found;
  }
  const [first] = info.palettes;
  if (first === undefined) {
    throw new Error("a design has no palettes");
  }
  return first;
}

export interface FontPairing {
  id: string;
  name: string;
  sample: string;
  /** CSS `font-family` for headings. */
  heading: string;
  /** CSS `font-family` for text. */
  body: string;
  /** The stylesheet that loads both, with `display=swap` and only the weights used. */
  href: string;
}

const SYSTEM = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
const SERIF = "Georgia, 'Times New Roman', serif";

export const FONTS: readonly FontPairing[] = [
  {
    id: "modern",
    name: "Modern",
    sample: "Plus Jakarta Sans and Inter",
    heading: `'Plus Jakarta Sans', ${SYSTEM}`,
    body: `'Inter', ${SYSTEM}`,
    href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Plus+Jakarta+Sans:wght@600;700;800&display=swap",
  },
  {
    id: "elegant",
    name: "Elegant",
    sample: "Playfair Display and Source Sans",
    heading: `'Playfair Display', ${SERIF}`,
    body: `'Source Sans 3', ${SYSTEM}`,
    href: "https://fonts.googleapis.com/css2?family=Playfair+Display:wght@500;600;700&family=Source+Sans+3:wght@400;500;600&display=swap",
  },
  {
    id: "friendly",
    name: "Friendly",
    sample: "Nunito and Nunito Sans",
    heading: `'Nunito', ${SYSTEM}`,
    body: `'Nunito Sans', ${SYSTEM}`,
    href: "https://fonts.googleapis.com/css2?family=Nunito+Sans:wght@400;600&family=Nunito:wght@700;800&display=swap",
  },
  {
    id: "editorial",
    name: "Editorial",
    sample: "Fraunces and DM Sans",
    heading: `'Fraunces', ${SERIF}`,
    body: `'DM Sans', ${SYSTEM}`,
    href: "https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600&family=Fraunces:wght@500;600;700&display=swap",
  },
];

export function fontPairing(id: string): FontPairing {
  const found = FONTS.find((f) => f.id === id);
  if (found !== undefined) {
    return found;
  }
  const [first] = FONTS;
  if (first === undefined) {
    throw new Error("no font pairings");
  }
  return first;
}
