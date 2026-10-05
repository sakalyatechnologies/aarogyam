import { ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router";

import { useDocumentTitle } from "@aarogyam/app-kit";
import { AuthHeading, AuthShell, SignInPanel, useAuth, useAuthState } from "@aarogyam/auth";

function returnPath(state: unknown): string | undefined {
  if (typeof state === "object" && state !== null && "from" in state && typeof state.from === "string" && state.from.startsWith("/")) {
    return state.from;
  }
  return undefined;
}

const POINTS = ["Service health, quality runs and clinics in one place", "Sakalya team only, signed in with a one-time email code", "Every change is attributed to the person who made it"] as const;

/** The console's shared frame: sign-in and the link callback both use it. */
export function ConsoleAuthShell({ children }: { children: ReactNode }) {
  return (
    <AuthShell
      name="Sakalya Console"
      tagline="Aarogyam operations"
      icon={<ShieldCheck aria-hidden="true" className="size-6" />}
      headline="See how Aarogyam is doing, at a glance"
      points={POINTS}
      visual="console"
      footer="Sakalya Technologies · for the Sakalya team"
    >
      {children}
    </AuthShell>
  );
}

export function SignInPage() {
  useDocumentTitle("Sign in", "Sakalya Console");
  const auth = useAuth();
  const state = useAuthState();
  const location = useLocation();
  if (state.status === "signed_in") {
    return <Navigate to={returnPath(location.state) ?? "/health"} replace />;
  }
  return (
    <ConsoleAuthShell>
      <AuthHeading title="Sign in" subtitle="For the Sakalya team." />
      <SignInPanel auth={auth} />
    </ConsoleAuthShell>
  );
}
