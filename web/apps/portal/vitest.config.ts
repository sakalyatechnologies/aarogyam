import { defineProject } from "vitest/config";

import { dedupe } from "./vite.config.js";

export default defineProject({
  resolve: { dedupe },
  test: {
    name: "portal",
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["./src/test/setup.ts"],
    // Linked sources import Base UI; run it through Vite so dedupe applies to its React import.
    server: { deps: { inline: [/@base-ui\/react/] } },
  },
});
