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
      port: 5173,
      strictPort: true,
      // VITE_API_MODE=http with an empty VITE_API_BASE_URL sends /api to the local Rust API.
      proxy: { "/api": { target: env["VITE_API_PROXY_TARGET"] ?? "http://localhost:8080" } },
    },
    preview: { port: 4173 },
  };
});
