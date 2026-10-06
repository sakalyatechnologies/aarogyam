// Aarogyam-owned route (not in the Lovable export).
import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { SignOutPage } from "@/aarogyam/SignOutPage";

export const Route = createFileRoute("/sign-out")({
  head: () => ({
    meta: [{ title: "Signed out — Aarogyam" }, { name: "robots", content: "noindex" }],
  }),
  component: SignOut,
});

function SignOut() {
  const navigate = useNavigate();
  return <SignOutPage onBack={() => navigate({ to: "/" })} onRegister={() => navigate({ to: "/register" })} />;
}
