// Aarogyam-owned route (not in the Lovable export). Draft page the store listings link to; see src/aarogyam/legal.
import { createFileRoute } from "@tanstack/react-router";

import { LegalPage } from "@/aarogyam/legal/LegalPage";
import { support } from "@/aarogyam/legal/support";

export const Route = createFileRoute("/support")({
  head: () => ({
    meta: [
      { title: "Aarogyam support (draft) — Aarogyam" },
      { name: "description", content: support.summary },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: () => <LegalPage doc={support} />,
});
