// Aarogyam-owned route (not in the Lovable export). Draft legal page; see src/aarogyam/legal.
import { createFileRoute } from "@tanstack/react-router";

import { LegalPage } from "@/aarogyam/legal/LegalPage";
import { dpa } from "@/aarogyam/legal/dpa";

export const Route = createFileRoute("/dpa")({
  head: () => ({
    meta: [
      { title: "Data Processing Agreement outline (draft) — Aarogyam" },
      { name: "description", content: dpa.summary },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: () => <LegalPage doc={dpa} />,
});
