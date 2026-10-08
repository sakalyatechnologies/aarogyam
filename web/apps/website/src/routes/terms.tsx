// Aarogyam-owned route (not in the Lovable export). Draft legal page; see src/aarogyam/legal.
import { createFileRoute } from "@tanstack/react-router";

import { LegalPage } from "@/aarogyam/legal/LegalPage";
import { terms } from "@/aarogyam/legal/terms";

export const Route = createFileRoute("/terms")({
  head: () => ({
    meta: [
      { title: "Terms of Service for clinics (draft) — Aarogyam" },
      { name: "description", content: terms.summary },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: () => <LegalPage doc={terms} />,
});
