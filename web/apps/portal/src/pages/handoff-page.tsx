import { Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";

import { useDocumentTitle } from "@aarogyam/app-kit";
import { AuthHeading, completeHandoff, useAuth } from "@aarogyam/auth";
import { Button } from "@sakalya/ui";

import { useServices } from "../clinic.js";
import { PortalAuthShell } from "./brand.js";

/**
 * Where central sign-in lands (`/auth/handoff#code=…`): redeems the one-time code on this
 * clinic's host, signs in here, then continues to `/` like any sign-in.
 */
export function HandoffPage() {
  useDocumentTitle("Signing in", "Aarogyam");
  const navigate = useNavigate();
  const auth = useAuth();
  const services = useServices();
  const [problem, setProblem] = useState<string>();
  const started = useRef(false);

  useEffect(() => {
    // Once per page: a code works once, so a second run would only fail.
    if (started.current) {
      return;
    }
    started.current = true;
    const hash = window.location.hash;
    // The code leaves the address bar (and the history) at once.
    window.history.replaceState(null, "", window.location.pathname);
    void completeHandoff(auth, hash, async (code) => {
      // Redeemed on this very host: the API refuses a code made for any other.
      const result = await services.clinic(window.location.hostname).redeemHandoff({ code });
      return result.ok ? result.value : null;
    }).then((outcome) => {
      if (outcome.ok) {
        void navigate("/", { replace: true });
      } else {
        setProblem(outcome.message);
      }
    });
    // Runs once per mount, guarded by `started`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <PortalAuthShell>
      {problem === undefined ? (
        <div role="status" className="flex items-center gap-3 text-sm text-muted">
          <Loader2 aria-hidden="true" className="size-5 animate-spin text-primary" />
          Signing you in…
        </div>
      ) : (
        <>
          <AuthHeading title="That sign-in link didn't work" />
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
    </PortalAuthShell>
  );
}
