import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

export const dedupe = ["react", "react-dom"];

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  return {
    plugins: [react()],
    resolve: { dedupe },
    build: { target: "es2022", cssCodeSplit: false },
    server: {
      port: 5175,
      strictPort: true,
      host: "127.0.0.1",
      // sunrise-site.localtest.me resolves to 127.0.0.1. /api goes to the local API with the
      // Host header kept; the API picks the clinic from it (see docs/website.md).
      allowedHosts: [".localtest.me"],
      proxy: { "/api": { target: env["VITE_API_PROXY_TARGET"] ?? "http://localhost:8080" } },
    },
    preview: { port: 4175, host: "127.0.0.1", allowedHosts: [".localtest.me"] },
  };
});
