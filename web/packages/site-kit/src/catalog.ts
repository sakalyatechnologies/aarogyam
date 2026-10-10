/** The designs, palettes and font pairings a clinic can choose. The API checks the same ids. */

export type TemplateId = "aurora" | "hearth" | "clinical" | "bold" | "heritage" | "smilebright" | "bentopeach" | "bentopistachio" | "bentomidnight";

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
  {
    id: "heritage",
    name: "Heritage",
    tagline: "Serif, classical and trusted. Centred layout, fine rules, long-established feel.",
    palettes: [
      { id: "forest", name: "Forest", bg: "#faf8f2", surface: "#ffffff", surface2: "#f1ece0", text: "#153b32", muted: "#4a5f58", line: "#e0d8c6", accent: "#8b5e1a", onAccent: "#ffffff", accentText: "#7a5214" },
      { id: "burgundy", name: "Burgundy", bg: "#fbf7f4", surface: "#ffffff", surface2: "#f4e9e4", text: "#3a1520", muted: "#6a4a52", line: "#e6d3cb", accent: "#7a1f3d", onAccent: "#ffffff", accentText: "#7a1f3d" },
      { id: "navy", name: "Navy", bg: "#f8f9fb", surface: "#ffffff", surface2: "#e9edf4", text: "#12233f", muted: "#4a5a74", line: "#d6dce8", accent: "#1f3a6b", onAccent: "#ffffff", accentText: "#1f3a6b" },
      { id: "ivory", name: "Ivory", bg: "#fdfaf3", surface: "#ffffff", surface2: "#f6eed9", text: "#2b2416", muted: "#5e553f", line: "#e8dcbc", accent: "#8a6a12", onAccent: "#ffffff", accentText: "#74590d" },
    ],
  },
  {
    id: "smilebright",
    name: "Smile Bright",
    tagline: "Playful and cheerful. Round shapes, bright colour, made for kids and families.",
    palettes: [
      { id: "sky", name: "Sky", bg: "#eef6ff", surface: "#ffffff", surface2: "#dcebff", text: "#10294a", muted: "#44587a", line: "#c8dcf5", accent: "#1f6feb", onAccent: "#ffffff", accentText: "#1a5fcc" },
      { id: "bubblegum", name: "Bubblegum", bg: "#fff0f6", surface: "#ffffff", surface2: "#ffdcec", text: "#3d1230", muted: "#6d4560", line: "#f6c8dc", accent: "#c2185b", onAccent: "#ffffff", accentText: "#a8134e" },
      { id: "sunshine", name: "Sunshine", bg: "#fff9e6", surface: "#ffffff", surface2: "#ffefb8", text: "#3a2a00", muted: "#6a5520", line: "#f3e0a0", accent: "#f5b800", onAccent: "#3a2a00", accentText: "#7a5600" },
      { id: "mint", name: "Mint", bg: "#effaf4", surface: "#ffffff", surface2: "#d6f3e3", text: "#0f3326", muted: "#41665a", line: "#bfe6d3", accent: "#0f9d6b", onAccent: "#04281c", accentText: "#0a7a53" },
    ],
  },
  {
    id: "bentopeach",
    name: "Peach Bento",
    tagline: "Warm tiles and big type. A grid of soft blocks on a peach page.",
    palettes: [
      { id: "peach", name: "Peach", bg: "#efbdae", surface: "#fbf1ee", surface2: "#dce9f8", text: "#3f4317", muted: "#4f531c", line: "#d9a898", accent: "#5e5a1f", onAccent: "#fbf6ef", accentText: "#4f4d18" },
      { id: "rose", name: "Rose", bg: "#f3c6cf", surface: "#fdf2f4", surface2: "#e4e8f6", text: "#4a1f2c", muted: "#5a2c3a", line: "#dba5b1", accent: "#7a2a45", onAccent: "#fdf6f7", accentText: "#6a2139" },
      { id: "sand", name: "Sand", bg: "#ecd5b0", surface: "#fbf5e8", surface2: "#dfe9ea", text: "#3a2f14", muted: "#4c3f1e", line: "#d3b98a", accent: "#6b4a14", onAccent: "#fbf6ef", accentText: "#5e4010" },
    ],
  },
  {
    id: "bentopistachio",
    name: "Pistachio Bento",
    tagline: "Fresh green tiles. A calm grid of blocks with big, confident headings.",
    palettes: [
      { id: "pistachio", name: "Pistachio", bg: "#dde8c9", surface: "#fbfaf3", surface2: "#fff6e4", text: "#22361f", muted: "#33492e", line: "#bfd0a6", accent: "#2f5a2a", onAccent: "#fbf6ef", accentText: "#2f5a2a" },
      { id: "lime", name: "Lime", bg: "#e4efb8", surface: "#fbfcee", surface2: "#f1f6d8", text: "#1f2f0c", muted: "#33471a", line: "#c2d27e", accent: "#3d5a12", onAccent: "#fbf6ef", accentText: "#3d5a12" },
      { id: "sea", name: "Sea", bg: "#cfe8e0", surface: "#f4fbf8", surface2: "#fdf3df", text: "#10312b", muted: "#21463e", line: "#a9d0c5", accent: "#0f5a4e", onAccent: "#fbf6ef", accentText: "#0f5a4e" },
    ],
  },
  {
    id: "bentomidnight",
    name: "Midnight Bento",
    tagline: "Dark tiles with gold accents. A bento grid for an evening-calm, premium feel.",
    palettes: [
      { id: "midnight", name: "Midnight", bg: "#12201b", surface: "#18302a", surface2: "#1e3a31", text: "#f2ebdd", muted: "#c5bfae", line: "#2c4a40", accent: "#c7933d", onAccent: "#12201b", accentText: "#d9a94f" },
      { id: "ocean", name: "Ocean", bg: "#0f1b2a", surface: "#162a40", surface2: "#1c3550", text: "#eef2f8", muted: "#b3bfd0", line: "#2a4560", accent: "#e0a84a", onAccent: "#0f1b2a", accentText: "#e8b860" },
      { id: "plum", name: "Plum", bg: "#1d1224", surface: "#2b1c37", surface2: "#35234a", text: "#f6eefa", muted: "#c6b8d2", line: "#463060", accent: "#e0a96d", onAccent: "#1d1224", accentText: "#e8b985" },
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
  {
    id: "classic",
    name: "Classic",
    sample: "Cormorant Garamond and Lora",
    heading: `'Cormorant Garamond', ${SERIF}`,
    body: `'Lora', ${SERIF}`,
    href: "https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,500;0,600;0,700;1,500;1,600&family=Lora:wght@400;500;600&display=swap",
  },
  {
    id: "display",
    name: "Display",
    sample: "Bebas Neue and DM Sans",
    heading: `'Bebas Neue', Impact, 'Arial Narrow', sans-serif`,
    body: `'DM Sans', ${SYSTEM}`,
    href: "https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@400;500;600&display=swap",
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
