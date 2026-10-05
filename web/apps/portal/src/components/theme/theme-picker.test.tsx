import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import { THEME_PALETTES, ThemePicker, type ThemeChoice } from "./theme-picker.js";

function Harness({ initial, onPick }: { initial: ThemeChoice; onPick?: (choice: ThemeChoice) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <ThemePicker
      value={value}
      onChange={(next) => {
        setValue(next);
        onPick?.(next);
      }}
    />
  );
}

describe("ThemePicker", () => {
  it("offers six to eight palettes, each in light and dark", () => {
    render(<Harness initial={{ brand: "#14A89A", mode: "light" }} />);
    expect(THEME_PALETTES.length).toBeGreaterThanOrEqual(6);
    expect(THEME_PALETTES.length).toBeLessThanOrEqual(8);
    const radios = within(screen.getByRole("radiogroup", { name: "Palette" })).getAllByRole("radio");
    expect(radios).toHaveLength(THEME_PALETTES.length * 2);
    expect(screen.getByRole("radio", { name: "Mint, light" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("radio", { name: "Mint, dark" }).getAttribute("aria-checked")).toBe("false");
  });

  it("applies a palette in dark at once, and can be switched back any time", async () => {
    const user = userEvent.setup();
    const picks: ThemeChoice[] = [];
    render(<Harness initial={{ brand: "#14A89A", mode: "light" }} onPick={(c) => picks.push(c)} />);
    await user.click(screen.getByRole("radio", { name: "Ocean, dark" }));
    expect(picks.at(-1)).toEqual({ brand: "#2563EB", mode: "dark" });
    expect(screen.getByRole("radio", { name: "Ocean, dark" }).getAttribute("aria-checked")).toBe("true");
    await user.click(screen.getByRole("radio", { name: "Mint, light" }));
    expect(picks.at(-1)).toEqual({ brand: "#14A89A", mode: "light" });
  });

  it("keeps the colour when only the mode changes", async () => {
    const user = userEvent.setup();
    const picks: ThemeChoice[] = [];
    render(<Harness initial={{ brand: "#2563EB", mode: "light" }} onPick={(c) => picks.push(c)} />);
    await user.click(within(screen.getByRole("radiogroup", { name: "Mode" })).getByRole("radio", { name: "Dark" }));
    expect(picks.at(-1)).toEqual({ brand: "#2563EB", mode: "dark" });
  });

  it("takes a custom brand colour, refuses a malformed one, and says it is in use", async () => {
    const user = userEvent.setup();
    const picks: ThemeChoice[] = [];
    render(<Harness initial={{ brand: "#14A89A", mode: "light" }} onPick={(c) => picks.push(c)} />);
    const hex = screen.getByLabelText(/Custom brand colour/);
    await user.clear(hex);
    await user.type(hex, "#12");
    await user.keyboard("{Enter}");
    expect((await screen.findByRole("alert")).textContent).toBe("Enter a colour like #0F766E.");
    expect(picks).toHaveLength(0);

    await user.clear(hex);
    await user.type(hex, "0f766e");
    await user.keyboard("{Enter}");
    expect(picks.at(-1)).toEqual({ brand: "#0F766E", mode: "light" });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByLabelText("Custom brand colour (in use)")).toBeTruthy();
  });
});
