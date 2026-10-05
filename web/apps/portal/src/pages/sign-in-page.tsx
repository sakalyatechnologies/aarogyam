import { Navigate, useLocation } from "react-router";

import { useDocumentTitle } from "@aarogyam/app-kit";
import { AuthHeading, SignInPanel, useAuth, useAuthState } from "@aarogyam/auth";
import { Link } from "@sakalya/ui";

import { PortalAuthShell } from "./brand.js";

function returnPath(state: unknown): string | undefined {
  if (typeof state === "object" && state !== null && "from" in state && typeof state.from === "string" && state.from.startsWith("/")) {
    return state.from;
  }
  return undefined;
}

export function SignInPage() {
  useDocumentTitle("Sign in", "Aarogyam");
  const auth = useAuth();
  const state = useAuthState();
  const location = useLocation();
  if (state.status === "signed_in") {
    return <Navigate to={returnPath(location.state) ?? "/"} replace />;
  }
  return (
    <PortalAuthShell>
      <AuthHeading title="Sign in" subtitle="For clinic owners, doctors and staff." />
      <SignInPanel auth={auth} />
      <p className="mt-8 text-sm text-muted">
        New to Aarogyam?{" "}
        <Link href="/register" className="font-semibold text-primary-text underline-offset-2 hover:underline">
          Register your clinic
        </Link>
      </p>
    </PortalAuthShell>
  );
}
