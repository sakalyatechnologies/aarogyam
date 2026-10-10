import { describe, expect, it } from "vitest";

import { sampleToday } from "./sample-data.js";

describe("the setup's sample clinic day", () => {
  it("is valid against the API's own schema", () => {
    expect(sampleToday().appointments.length).toBeGreaterThan(3);
  });
});
