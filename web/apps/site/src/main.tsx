import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { createHttpClient } from "@aarogyam/api-client";

import { App } from "./app.js";
import { readEnv } from "./env.js";

const root = document.getElementById("root");
if (root !== null) {
  try {
    const env = readEnv();
    // The sample clinic exists only in development builds; a production build always reads the API.
    const client = import.meta.env.DEV && env.apiMode === "fake" ? await (await import("./dev-sample.js")).devSample() : createHttpClient(env.apiBaseUrl, () => null);
    createRoot(root).render(
      <StrictMode>
        <App client={client} env={env} />
      </StrictMode>,
    );
  } catch (error) {
    root.textContent = error instanceof Error ? error.message : "This website could not start.";
  }
}
