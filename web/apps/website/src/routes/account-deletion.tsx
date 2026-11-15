// Aarogyam-owned route (not in the Lovable export). Draft page the store listings link to; see src/aarogyam/legal.
import { createFileRoute } from "@tanstack/react-router";

import { LegalPage } from "@/aarogyam/legal/LegalPage";
import { accountDeletion } from "@/aarogyam/legal/account-deletion";

export const Route = createFileRoute("/account-deletion")({
  head: () => ({
    meta: [
      { title: "Delete your Aarogyam account (draft) — Aarogyam" },
      { name: "description", content: accountDeletion.summary },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: () => <LegalPage doc={accountDeletion} />,
});
