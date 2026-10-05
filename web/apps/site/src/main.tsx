import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { createHttpClient, type ApiClient } from "@aarogyam/api-client";

import { App } from "./app.js";
import { readEnv } from "./env.js";

/** Without an API (local development), a sample clinic with its website published. */
async function fakeClient(): Promise<ApiClient> {
  const { createFakeBackend, createFixtures, fakeTokenFor } = await import("@aarogyam/api-client/fake");
  const backend = createFakeBackend(createFixtures());
  const host = "sunrise.localtest.me";
  const owner = backend.client({ host, getToken: () => fakeTokenFor({ id: "a1a1a1a1-0000-4000-8000-000000000001" }) });
  await owner.updateWebsite({ published: true });
  return backend.client({ host, getToken: () => null });
}

const root = document.getElementById("root");
if (root !== null) {
  try {
    const env = readEnv();
    // The sample clinic exists only in development builds; a production build always reads the API.
    const client = import.meta.env.DEV && env.apiMode === "fake" ? await fakeClient() : createHttpClient(env.apiBaseUrl, () => null);
    createRoot(root).render(
      <StrictMode>
        <App client={client} env={env} />
      </StrictMode>,
    );
  } catch (error) {
    root.textContent = error instanceof Error ? error.message : "This website could not start.";
  }
}
