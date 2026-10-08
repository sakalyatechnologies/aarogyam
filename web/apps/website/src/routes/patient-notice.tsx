// Aarogyam-owned route (not in the Lovable export). Draft legal page; see src/aarogyam/legal.
import { createFileRoute } from "@tanstack/react-router";

import { LegalPage } from "@/aarogyam/legal/LegalPage";
import { notice } from "@/aarogyam/legal/notice";

export const Route = createFileRoute("/patient-notice")({
  head: () => ({
    meta: [
      { title: "Patient privacy notice template (draft) — Aarogyam" },
      { name: "description", content: notice.summary },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: () => <LegalPage doc={notice} />,
});
