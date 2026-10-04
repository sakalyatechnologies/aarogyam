import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
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
      port: 5174,
      strictPort: true,
      host: "127.0.0.1",
      // console.localtest.me resolves to 127.0.0.1; the API tells hosts apart by name.
      allowedHosts: [".localtest.me"],
      // Same-origin /api goes to the local API with the browser's Host header kept
      // (changeOrigin stays false), because the API picks the clinic or console from it.
      proxy: { "/api": { target: env["VITE_API_PROXY_TARGET"] ?? "http://localhost:8080" } },
    },
    preview: { port: 4174, host: "127.0.0.1", allowedHosts: [".localtest.me"] },
  };
});
