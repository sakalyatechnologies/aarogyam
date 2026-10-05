import { defineProject } from "vitest/config";

import { dedupe } from "./vite.config.js";

export default defineProject({
  resolve: { dedupe },
  test: { name: "site", environment: "jsdom", include: ["src/**/*.test.{ts,tsx}"] },
});
