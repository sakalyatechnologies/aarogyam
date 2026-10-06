import { Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";

import { useDocumentTitle } from "@aarogyam/app-kit";
import { AuthHeading, completeHandoff, useAuth } from "@aarogyam/auth";
import { Button } from "@sakalya/ui";

import { useApi } from "../api.js";
import { NO_CONSOLE_ACCESS, useLeaveForNoAccess } from "../layout/console-access.js";
import { ConsoleAuthShell } from "./sign-in-page.js";

/**
 * Where central sign-in lands (`/auth/handoff#code=…`): redeems the one-time code on the
 * console host, signs in here, then lands on its home (service health).
 */
export function HandoffPage() {
  useDocumentTitle("Signing in", "Sakalya Console");
  const navigate = useNavigate();
  const auth = useAuth();
  const api = useApi();
  const [problem, setProblem] = useState<string>();
  const [leave, setLeave] = useState(false);
  useLeaveForNoAccess(leave);
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
      const result = await api.redeemHandoff({ code });
      return result.ok ? result.value : null;
    }).then((outcome) => {
      if (!outcome.ok) {
        setProblem(outcome.message);
        return;
      }
      // Signed in is not enough: only Sakalya staff may hold a console session.
      void api.getMe().then((me) => {
        if (me.ok && me.value.console_access) {
          void navigate("/health", { replace: true });
        } else {
          setProblem(me.ok ? NO_CONSOLE_ACCESS : "We could not check your console access. Sign in again.");
          setLeave(true);
        }
      });
    });
    // Runs once per mount, guarded by `started`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <ConsoleAuthShell>
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
    </ConsoleAuthShell>
  );
}
