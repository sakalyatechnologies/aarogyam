import { Loader2 } from "lucide-react";
import { useNavigate } from "react-router";

import { useDocumentTitle } from "@aarogyam/app-kit";
import { AuthHeading, useCompleteAuthRedirect } from "@aarogyam/auth";
import { Button } from "@sakalya/ui";

import { ConsoleAuthShell } from "./sign-in-page.js";

/** Where a sign-in email's link lands (`emailRedirectTo`). Finishes the sign-in, then continues home. */
export function AuthCallbackPage() {
  useDocumentTitle("Signing in", "Sakalya Console");
  const navigate = useNavigate();
  const { problem } = useCompleteAuthRedirect(() => {
    void navigate("/", { replace: true });
  });

  return (
    <ConsoleAuthShell>
      {problem === undefined ? (
        <div role="status" className="flex items-center gap-3 text-sm text-muted">
          <Loader2 aria-hidden="true" className="size-5 animate-spin text-primary" />
          Signing you in…
        </div>
      ) : (
        <>
          <AuthHeading title="That link didn't work" />
          <p role="alert" className="mb-5 rounded-xl bg-danger-soft px-4 py-3 text-sm font-medium text-danger-text">
            {problem}
          </p>
          <Button
            onClick={() => {
              void navigate("/sign-in", { replace: true });
            }}
          >
            Back to sign in
          </Button>
        </>
      )}
    </ConsoleAuthShell>
  );
}
