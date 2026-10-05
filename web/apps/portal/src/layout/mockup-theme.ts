import { contrastRatio, createTheme, ensureContrast, hex, lighten, mix, readableOn, type HexColor, type Theme, type ThemeMode } from "@sakalya/tokens";

/** The mock-up's own green: the look a clinic gets until it sets a brand colour. */
export const MOCKUP_BRAND = hex("#136650");

const AA = 4.5;
const WHITE = hex("#ffffff");

/**
 * The mock-up's palette (aarogyam-dashboard-full.html) applied over the generated theme in light
 * mode. The brand colour still comes from the clinic's branding; neutrals, status colours and the
 * 18px radius are the mock-up's. Text colours are nudged just enough to stay AA readable (the
 * mock-up's muted grey and amber fall slightly short).
 */
export function mockupTheme(brand: HexColor, mode: ThemeMode): Theme {
  const base = createTheme({ brand, mode, radius: 18, surface: "soft" });
  if (mode === "dark") {
    return base;
  }
  const status = (solid: string, soft: string) => ({ solid: hex(solid), soft: hex(soft), text: ensureContrast(hex(solid), hex(soft), AA) });
  const amber = status("#a86e0f", "#f9efda");
  const red = status("#b3261e", "#fbe9e7");
  const green = status("#1b734a", "#ddf2e5");
  const indigo = status("#4338ca", "#e8e8fb");
  const surface = hex("#ffffff");
  const bg = hex("#eef2ef");
  return {
    ...base,
    colors: {
      ...base.colors,
      background: bg,
      surface,
      surfaceMuted: hex("#f6f9f7"),
      border: hex("#dde5e0"),
      text: hex("#14201b"),
      textMuted: ensureContrast(hex("#71837a"), bg, AA),
      primarySoft: lighten(base.colors.primary, 0.89),
      primaryText: ensureContrast(base.colors.primary, lighten(base.colors.primary, 0.89), AA),
      onWarning: readableOn(amber.solid),
      onDanger: readableOn(red.solid),
      onSuccess: readableOn(green.solid),
      onInfo: readableOn(indigo.solid),
      warning: amber.solid,
      warningSoft: amber.soft,
      warningText: amber.text,
      danger: red.solid,
      dangerSoft: red.soft,
      dangerText: red.text,
      success: green.solid,
      successSoft: green.soft,
      successText: green.text,
      info: indigo.solid,
      infoSoft: indigo.soft,
      infoText: indigo.text,
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
