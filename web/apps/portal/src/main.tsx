import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { installClientErrorReporting } from "@aarogyam/app-kit";

import { App } from "./app.js";
import { readEnv } from "./env.js";
import { createServices } from "./services.js";
import "./styles.css";

installClientErrorReporting({ app: "portal" });

const root = document.getElementById("root");
if (root !== null) {
  try {
    const services = await createServices(readEnv());
    createRoot(root).render(
      <StrictMode>
        <App services={services} />
      </StrictMode>,
    );
  } catch (error) {
    root.textContent = error instanceof Error ? error.message : "Aarogyam could not start.";
  }
}
