import { describe, expect, it } from "vitest";

import { displayName } from "./patients.js";

describe("displayName", () => {
  it("title-cases names stored all in lower case", () => {
    expect(displayName("ram")).toBe("Ram");
    expect(displayName("sneha patil")).toBe("Sneha Patil");
    expect(displayName("aakash d'souza")).toBe("Aakash D'Souza");
    expect(displayName("anne-marie")).toBe("Anne-Marie");
  });

  it("leaves any other casing, and names without letters, as stored", () => {
    expect(displayName("McKenzie")).toBe("McKenzie");
    expect(displayName("SNEHA")).toBe("SNEHA");
    expect(displayName("ravi Kumar")).toBe("ravi Kumar");
    expect(displayName("राम")).toBe("राम");
  });
});
