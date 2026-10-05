import { defineProject } from "vitest/config";

export default defineProject({
  test: { name: "site-kit", environment: "jsdom", include: ["src/**/*.test.{ts,tsx}"] },
});
