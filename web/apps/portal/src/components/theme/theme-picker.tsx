// moves to sakalya-web: palette presets with light and dark, plus a custom brand colour.
import { useState } from "react";

import { PRESETS } from "@sakalya/tokens";

import "./theme-picker.css";

export type ThemeModeChoice = "light" | "dark";

export interface ThemeChoice {
  /** `#RRGGBB`. */
  brand: string;
  mode: ThemeModeChoice;
}

const HEX = /^#[0-9a-fA-F]{6}$/;

/** Ready-made palettes: the shared presets, by name. */
export const THEME_PALETTES = PRESETS.map((preset) => ({
  key: preset.key,
  name: preset.name,
  description: preset.description,
  brand: String(preset.brand).toUpperCase(),
}));

function sameColour(a: string | undefined, b: string): boolean {
  return a?.toUpperCase() === b.toUpperCase();
}

/**
 * Pick a palette (each in light or dark) or type any brand colour. Calls `onChange` at once with
 * the new choice, so the product can apply it live and save it. Switching never loses the other
 * half of the choice: a palette keeps the current mode, and a mode keeps the current colour.
 */
export function ThemePicker({
  value,
  onChange,
  disabled = false,
}: {
  value: ThemeChoice;
  onChange: (next: ThemeChoice) => void;
  disabled?: boolean;
}) {
  const [custom, setCustom] = useState(value.brand);
  const [problem, setProblem] = useState<string>();
  const isPalette = THEME_PALETTES.some((palette) =>
    sameColour(value.brand, palette.brand),
  );
  const applyCustom = (text: string) => {
    const colour = text.trim().startsWith("#")
      ? text.trim()
      : `#${text.trim()}`;
    if (!HEX.test(colour)) {
      setProblem("Enter a colour like #0F766E.");
      return;
    }
    setProblem(undefined);
    onChange({ brand: colour.toUpperCase(), mode: value.mode });
  };
  return (
    <div className="thp">
      <div role="radiogroup" aria-label="Palette" className="thp-grid">
        {THEME_PALETTES.map((palette) => (
          <div
            key={palette.key}
            className="thp-card"
            data-selected={sameColour(value.brand, palette.brand)}
          >
            <div className="thp-name">
              <b>{palette.name}</b>
              <span>{palette.description}</span>
            </div>
            <div className="thp-swatches">
              {(["light", "dark"] as const).map((mode) => {
                const selected =
                  sameColour(value.brand, palette.brand) && value.mode === mode;
                return (
                  <button
                    key={mode}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    aria-label={`${palette.name}, ${mode}`}
                    disabled={disabled}
                    className="thp-swatch"
                    data-mode={mode}
                    onClick={() => {
                      setCustom(palette.brand);
                      setProblem(undefined);
                      onChange({ brand: palette.brand, mode });
                    }}
                  >
                    <i aria-hidden="true" style={{ backgroundColor: palette.brand }} />
                    <span>{mode === "light" ? "Light" : "Dark"}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <div className="thp-custom">
        <label className="mk-flabel" htmlFor="thp-custom-hex">
          Custom brand colour{isPalette ? "" : " (in use)"}
        </label>
        <div className="thp-row">
          <input
            type="color"
            aria-label="Pick a brand colour"
            disabled={disabled}
            value={HEX.test(custom) ? custom : value.brand}
            onChange={(event) => {
              setCustom(event.currentTarget.value.toUpperCase());
              applyCustom(event.currentTarget.value);
            }}
          />
          <input
            id="thp-custom-hex"
            className="mk-tin mk-mono"
            value={custom}
            maxLength={7}
            disabled={disabled}
            aria-invalid={problem !== undefined}
            onChange={(event) => {
              setCustom(event.currentTarget.value);
            }}
            onBlur={() => {
              if (custom !== "" && !sameColour(custom, value.brand)) {
                applyCustom(custom);
              }
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                applyCustom(custom);
              }
            }}
          />
          <div role="radiogroup" aria-label="Mode" className="thp-modes">
            {(["light", "dark"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                role="radio"
                aria-checked={value.mode === mode}
                disabled={disabled}
                className="mk-btn mk-btn-ghost"
                onClick={() => {
                  onChange({ brand: value.brand, mode });
                }}
              >
                {mode === "light" ? "Light" : "Dark"}
              </button>
            ))}
          </div>
        </div>
        {problem === undefined ? null : (
          <p
            role="alert"
            className="mk-hint"
            style={{ color: "var(--red)", margin: "4px 0 0" }}
          >
            {problem}
          </p>
        )}
      </div>
    </div>
  );
}
