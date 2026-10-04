import { HeartPulse } from "lucide-react";
import { useNavigate } from "react-router";

import { useDocumentTitle } from "@aarogyam/app-kit";
import { useCompleteAuthRedirect } from "@aarogyam/auth";
import { Button, Card } from "@sakalya/ui";

/**
 * Where a sign-in email's link lands (`emailRedirectTo`). Finishes the sign-in, then continues
 * to `/`, which sends a signed-in person on to their clinic (or the chooser) the same way a
 * typed code would.
 */
export function AuthCallbackPage() {
  useDocumentTitle("Signing in", "Aarogyam");
  const navigate = useNavigate();
  const { problem } = useCompleteAuthRedirect(() => {
    void navigate("/", { replace: true });
  });

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
          {problem === undefined ? (
            <p className="text-sm text-muted">Signing you in…</p>
          ) : (
            <>
              <h1 className="mb-1 text-2xl font-extrabold tracking-tight text-text">That link didn't work</h1>
              <p role="alert" className="mb-5 text-sm text-danger-text">
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
        </Card>
      </div>
    </main>
  );
}
