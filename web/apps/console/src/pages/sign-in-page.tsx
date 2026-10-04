import { Navigate, useLocation } from "react-router";

import { useDocumentTitle } from "@aarogyam/app-kit";
import { SignInPanel, useAuth, useAuthState } from "@aarogyam/auth";
import { Card } from "@sakalya/ui";

import { ConsoleBrand } from "../brand.js";

function returnPath(state: unknown): string | undefined {
  if (typeof state === "object" && state !== null && "from" in state && typeof state.from === "string" && state.from.startsWith("/")) {
    return state.from;
  }
  return undefined;
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
    <main className="flex min-h-full items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <ConsoleBrand />
        <Card className="mt-6">
          <h1 className="mb-1 text-2xl font-extrabold tracking-tight text-text">Sign in</h1>
          <p className="mb-5 text-sm text-muted">For the Sakalya team.</p>
          <SignInPanel auth={auth} />
        </Card>
      </div>
    </main>
  );
}
