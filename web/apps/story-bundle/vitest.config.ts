import { defineProject } from "vitest/config";

import { dedupe } from "./vite.config.js";

export default defineProject({
  resolve: { dedupe },
  test: { name: "story-bundle", environment: "jsdom", include: ["src/**/*.test.{ts,tsx}"] },
});
