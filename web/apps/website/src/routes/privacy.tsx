// Aarogyam-owned route (not in the Lovable export). Draft legal page; see src/aarogyam/legal.
import { createFileRoute } from "@tanstack/react-router";

import { LegalPage } from "@/aarogyam/legal/LegalPage";
import { privacy } from "@/aarogyam/legal/privacy";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "Privacy Policy (draft) — Aarogyam" },
      { name: "description", content: privacy.summary },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: () => <LegalPage doc={privacy} />,
});
