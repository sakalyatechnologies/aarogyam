import { LetterheadPanel } from "./letterhead-panel.js";
import { ThemePanel } from "./theme-panel.js";

/**
 * The setup wizard's "Your look" step: the portal's theme, then the letterhead, inside the step's own card.
 * Settings shows the two as separate tabs (see `ThemePanel` and `LetterheadPanel`).
 */
export function LetterheadThemePanel() {
  return (
    <>
      <ThemePanel bare />
      <LetterheadPanel bare />
    </>
  );
}
