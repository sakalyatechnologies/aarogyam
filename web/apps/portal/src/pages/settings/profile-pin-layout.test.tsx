import { describe, expect, it } from "vitest";

import settingsCss from "./settings.css?raw";
import panel from "./profile-panel.tsx?raw";

describe("Clinic profile PIN, city and state", () => {
  it("are laid out in one row and labelled like every other field", () => {
    expect(panel).toContain("st-pin");
    expect(settingsCss).toMatch(/\.st-pin \{[^}]*repeat\(3, minmax\(0, 1fr\)\)/);
    expect(settingsCss).toMatch(/\.st-pin label \{[^}]*text-transform: uppercase/);
  });
});
