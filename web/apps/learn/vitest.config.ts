import { defineProject } from "vitest/config";

export default defineProject({
  test: { name: "learn", environment: "node", include: ["src/**/*.test.ts"] },
});
