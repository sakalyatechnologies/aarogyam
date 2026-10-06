// Aarogyam-owned route (not in the Lovable export).
import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { SignInPage } from "@/aarogyam/SignInPage";

export const Route = createFileRoute("/sign-in")({
  head: () => ({
    meta: [
      { title: "Sign in — Aarogyam" },
      { name: "description", content: "Sign in to Aarogyam with your work email." },
    ],
  }),
  component: SignIn,
});

function SignIn() {
  const navigate = useNavigate();
  return <SignInPage onBack={() => navigate({ to: "/" })} onRegister={() => navigate({ to: "/register" })} />;
}
