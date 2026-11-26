import { describe, expect, it } from "vitest";

import { dobToIso, maskDob } from "./dob-input.js";

describe("date of birth, the Indian way", () => {
  it("masks typed digits as dd/mm/yyyy", () => {
    expect(maskDob("12051990")).toBe("12/05/1990");
    expect(maskDob("1205")).toBe("12/05");
  });
  it("turns dd/mm/yyyy into ISO, and rejects dates that do not exist", () => {
    expect(dobToIso("12/05/1990")).toBe("1990-05-12");
    expect(dobToIso("31/02/1990")).toBe("");
    expect(dobToIso("12/05")).toBe("");
  });
});
