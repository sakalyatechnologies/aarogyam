import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The linked @sakalya packages would otherwise load React from their own checkout; one copy only.
export const dedupe = ["react", "react-dom", "lucide-react"];

// The phone apps serve dist/ (synced to mobile/story-bundle/story/) from a secure origin:
// https://appassets.androidplatform.net/story/ and aarostory://story/. So every path is relative,
// and nothing is fetched from the network.
export default defineConfig({
  base: "./",
  plugins: [react()],
  resolve: { dedupe },
  build: {
    target: "es2022",
    // The preload polyfill fetches modules; the WebViews support modulepreload natively.
    modulePreload: { polyfill: false },
    assetsInlineLimit: 0,
  },
  server: { port: 5176, strictPort: true, host: "127.0.0.1" },
  preview: { port: 4176, host: "127.0.0.1" },
});
