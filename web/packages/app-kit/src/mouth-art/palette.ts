// Tooth colours. Shade tokens mix the patient's shade toward a target in sRGB (as the approved
// prototype, teeth-proto/tooth-art.json); named colours are fixed.

export const SHADES = { A1: "#EFE5CF", A2: "#EADBBE", A3: "#E3D0AC", "A3.5": "#DAC39C", P: "#F3EEE4" } as const;
export type Shade = keyof typeof SHADES;

/** Shade by age, as the prototype's shadeByAge; milk teeth use the whiter "P". */
export function shadeForAge(age: number | undefined, primary = false): Shade {
  if (primary) return "P";
  if (age === undefined) return "A2";
  if (age <= 19) return "A1";
  if (age <= 39) return "A2";
  if (age <= 59) return "A3";
  return "A3.5";
}

const TOKENS: Record<string, readonly [string, number]> = {
  enamelHi: ["#FFFFFF", 0.62], enamel: ["#FFFFFF", 0], tipTrans: ["#A9B3BF", 0.28],
  translucent: ["#A2AFBF", 0.45], neck: ["#C68E50", 0.3], neckDeep: ["#A5703C", 0.45],
  shadow: ["#5A4330", 0.58], dentin: ["#DCA65A", 0.42], dentinDeep: ["#C38640", 0.58],
  dentinLine: ["#8A6233", 0.6], enamelCut: ["#F7F5F0", 0.5], enamelCutDeep: ["#BFC5CB", 0.35],
  root: ["#D4A86C", 0.42], rootDeep: ["#A27744", 0.55], composite: ["#F4EEE4", 0.3],
  compositeEdge: ["#7A6650", 0.55], porcelain: ["#FFFFFF", 0.42], porcelainHi: ["#FFFFFF", 0.85],
  porcelainNeck: ["#E2CDA8", 0.25], core: ["#E7ECF0", 0.6],
};

const COLORS: Record<string, string> = {
  white: "#FFFFFF", black: "#000000", gumLight: "#F5BBB7", gum: "#EDA5A5", gumMid: "#E9A0A3", gumDeep: "#DE8E97",
  mucosa: "#C46B78", gumCut: "#E9A0A2", gumCutDeep: "#D98088", bone: "#EBDCC2", boneDeep: "#D9C29C",
  boneCortex: "#F6EDDD", boneHole: "#C9AE83", pdl: "#B88276", pulp: "#EFA2A0", pulpDeep: "#D7727A",
  pulpInflamed: "#D8262E", pulpInflamedDeep: "#93121C", vessel: "#B8323C", nerve: "#F3D891", caries: "#2A170C",
  cariesMid: "#5E361A", cariesBrown: "#8A5A2C", cariesHalo: "#C29A62", cariesNeutral: "#7D6A58", gutta: "#E8683A",
  guttaDeep: "#B5401E", amalgamHi: "#EEF0F3", amalgam: "#A2A8AF", amalgamDeep: "#5C626A", fissure: "#5A4434",
  cement: "#9C8C78", canalVoid: "#FBF6EE", steel: "#8C959E", temporary: "#CDBFAE", calcium_hydroxide: "#FBFAF6",
  mta: "#E2DED4", glassIonomer: "#EFE8DA", resin: "#FFF4D6", fissureStain: "#4A3020", gumInflamed: "#C7404F",
  blood: "#C0182A", crack: "#3B2A1E", markInk: "#1E5E52",
};

function hex(c: string): [number, number, number] {
  const n = Number.parseInt(c.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const toHex = (rgb: [number, number, number]) => "#" + rgb.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");

/** CSS colour of a paint name (token, colour name or "#hex") for a shade, with optional opacity. */
export function paintColor(name: string, shade: Shade, opacity = 1): string {
  let base: string;
  const token = TOKENS[name];
  if (token) {
    const a = hex(SHADES[shade]), b = hex(token[0]), t = token[1];
    base = toHex([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
  } else {
    base = name.startsWith("#") ? name : (COLORS[name] ?? "#FF00FF");
  }
  if (opacity >= 1) return base;
  const [r, g, b] = hex(base);
  return `rgba(${String(r)},${String(g)},${String(b)},${String(Math.round(opacity * 1000) / 1000)})`;
}

/** Whether a paint name is known (used by the coverage test). */
export function isKnownPaint(name: string): boolean {
  return name in TOKENS || name in COLORS || /^#[0-9A-Fa-f]{6}$/.test(name);
}
