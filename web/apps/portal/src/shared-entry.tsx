/** The small entry for patient links (`shared.html`, served for `/shared/*` by the portal Worker). */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { tokenFromPath, VisitPage } from "./visit-page/visit-page.js";
import "./visit-page/visit-page.css";

const root = document.getElementById("root");
if (root !== null) {
  createRoot(root).render(
    <StrictMode>
      <VisitPage token={tokenFromPath(window.location.pathname)} />
    </StrictMode>,
  );
}
