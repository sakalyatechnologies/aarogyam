import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

// TanStack Start with static prerendering: `vite build` writes plain HTML for every page
// (dist/client/index.html, register/, workspace/) plus the client bundle, which Cloudflare Pages
// serves with no server. The Lovable original ran an SSR server (Nitro); nothing here needs one.
export default defineConfig({
  plugins: [
    tanstackStart({ prerender: { enabled: true, crawlLinks: true } }),
    react(),
    tailwindcss(),
  ],
  resolve: { dedupe: ["react", "react-dom", "@tanstack/react-router"], tsconfigPaths: true },
  server: { port: 5176, strictPort: true, host: "127.0.0.1" },
  preview: { port: 4176, host: "127.0.0.1" },
});
