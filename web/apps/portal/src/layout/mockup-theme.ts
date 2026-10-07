import { contrastRatio, createTheme, ensureContrast, hex, lighten, mix, readableOn, type HexColor, type Theme, type ThemeMode } from "@sakalya/tokens";

/** The mock-up's own green: the look a clinic gets until it sets a brand colour. */
export const MOCKUP_BRAND = hex("#136650");

const AA = 4.5;
const WHITE = hex("#ffffff");

/**
 * The founder's V4 palette (aarogyam-doctor-staff-mockups.html) applied over the generated theme in
 * light mode. The brand colour still comes from the clinic's branding; neutrals (sage page, white
 * panels, green-grey ink), status colours (Ready green, Waiting amber, Confirmed blue, No-show red)
 * and the 20px radius are V4's. Text colours are nudged just enough to stay AA readable.
 */
export function mockupTheme(brand: HexColor, mode: ThemeMode): Theme {
  const base = createTheme({ brand, mode, radius: 20, surface: "soft" });
  if (mode === "dark") {
    return base;
  }
  const status = (solid: string, soft: string) => ({ solid: hex(solid), soft: hex(soft), text: ensureContrast(hex(solid), hex(soft), AA) });
  const amber = status("#a86e0f", "#fff1de");
  const red = status("#b3261e", "#fdeceb");
  const green = status("#1b734a", "#e6f3eb");
  const blue = status("#345983", "#e7eefc");
  const surface = hex("#ffffff");
  const bg = hex("#f4f7f5");
  return {
    ...base,
    colors: {
      ...base.colors,
      background: bg,
      surface,
      surfaceMuted: hex("#f8faf9"),
      border: hex("#e2eae5"),
      text: hex("#172e27"),
      textMuted: ensureContrast(hex("#4e6257"), bg, AA),
      primarySoft: lighten(base.colors.primary, 0.89),
      primaryText: ensureContrast(base.colors.primary, lighten(base.colors.primary, 0.89), AA),
      onWarning: readableOn(amber.solid),
      onDanger: readableOn(red.solid),
      onSuccess: readableOn(green.solid),
      onInfo: readableOn(blue.solid),
      warning: amber.solid,
      warningSoft: amber.soft,
      warningText: amber.text,
      danger: red.solid,
      dangerSoft: red.soft,
      dangerText: red.text,
      success: green.solid,
      successSoft: green.soft,
      successText: green.text,
      info: blue.solid,
      infoSoft: blue.soft,
      infoText: blue.text,
    },
  };
}

/**
 * The second stop of the brand gradients (hero, drawer header, active menu, primary button).
 * It moves away from the label colour, so the label reads on both stops: darker under white
 * labels, lighter under ink labels.
 */
export function brandGradientEnd(theme: Theme): HexColor {
  const { primary, onPrimary } = theme.colors;
  const lightLabel = contrastRatio(onPrimary, WHITE) < 1.5;
  const end = mix(primary, lightLabel ? hex("#000000") : WHITE, 0.78);
  return ensureContrast(end, onPrimary, AA);
}

/** Custom properties the mock-up stylesheet reads, on top of the theme's `--sk-*` ones. */
export function mockupVars(theme: Theme): Record<"--mk-brand2", string> {
  return { "--mk-brand2": brandGradientEnd(theme) };
}
