import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: ["web/packages/*", "web/apps/*"],
  },
});
