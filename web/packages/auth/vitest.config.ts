import { defineProject } from "vitest/config";

// The linked @sakalya packages resolve React from their own checkout unless deduped here.
export default defineProject({
  resolve: { dedupe: ["react", "react-dom", "lucide-react", "@sakalya/tokens", "@sakalya/ui"] },
  test: { name: "auth", environment: "jsdom", include: ["src/**/*.test.{ts,tsx}"], testTimeout: 15_000 },
});
