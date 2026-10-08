// Aarogyam-owned route (not in the Lovable export). Index of the draft legal pages.
import { createFileRoute } from "@tanstack/react-router";

import { LegalIndex } from "@/aarogyam/legal/LegalPage";

export const Route = createFileRoute("/legal")({
  head: () => ({
    meta: [
      { title: "Legal (draft) — Aarogyam" },
      { name: "description", content: "Privacy, terms and data processing for Aarogyam, in plain language." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: LegalIndex,
});
