import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";

// The linked @sakalya packages would otherwise load React, Base UI and icons from their own
// checkout, and two Reacts break hooks. The app depends on each, so all resolve to one copy.
export const dedupe = ["react", "react-dom", "@base-ui/react", "lucide-react", "@sakalya/tokens", "@sakalya/ui"];

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  return {
    plugins: [react(), tailwindcss()],
    resolve: { dedupe },
    server: {
      port: 5173,
      strictPort: true,
      host: "127.0.0.1",
      // Compile every page at start-up rather than on its first visit, so the first screen a
      // person (or an end-to-end test) opens after a restart doesn't wait seconds for it.
      // Not under Vitest, which serves only the modules its tests import.
      ...(process.env["VITEST"] === undefined ? { warmup: { clientFiles: ["./src/main.tsx", "./src/pages/**/*.tsx", "!./src/**/*.test.tsx"] } } : {}),
      // sunrise.localtest.me and app.localtest.me resolve to 127.0.0.1; the API tells hosts apart by name.
      allowedHosts: [".localtest.me"],
      // Same-origin /api goes to the local API with the browser's Host header kept
      // (changeOrigin stays false), because the API picks the clinic or console from it.
      proxy: { "/api": { target: env["VITE_API_PROXY_TARGET"] ?? "http://localhost:8080" } },
    },
    // Two pages: the portal, and the small patient-link page (`shared.html`, served for
    // `/shared/*` by the portal Worker) that loads none of the portal's code.
    build: {
      // The manifest feeds the patient page's lazy budgets (scripts/check-shared-size.mjs).
      manifest: true,
      rollupOptions: {
        input: {
          index: fileURLToPath(new URL("./index.html", import.meta.url)),
          shared: fileURLToPath(new URL("./shared.html", import.meta.url)),
        },
      },
    },
    preview: { port: 4173, host: "127.0.0.1", allowedHosts: [".localtest.me"] },
  };
});
