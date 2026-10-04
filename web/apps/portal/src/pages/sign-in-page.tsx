import { HeartPulse } from "lucide-react";
import { Navigate, useLocation } from "react-router";

import { useDocumentTitle } from "@aarogyam/app-kit";
import { SignInPanel, useAuth, useAuthState } from "@aarogyam/auth";
import { Card } from "@sakalya/ui";

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
    <main className="flex min-h-full items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="flex items-center gap-3">
          <span className="flex size-11 items-center justify-center rounded-2xl bg-primary text-on-primary">
            <HeartPulse aria-hidden="true" className="size-6" />
          </span>
          <div className="leading-tight">
            <p className="text-lg font-extrabold tracking-tight text-text">Aarogyam</p>
            <p className="text-xs text-muted">Ārogyaṁ dhana sampadā</p>
          </div>
        </div>
        <Card className="mt-6">
          <h1 className="mb-1 text-2xl font-extrabold tracking-tight text-text">Sign in</h1>
          <p className="mb-5 text-sm text-muted">For clinic owners, doctors and staff.</p>
          <SignInPanel auth={auth} />
        </Card>
      </div>
    </main>
  );
}
