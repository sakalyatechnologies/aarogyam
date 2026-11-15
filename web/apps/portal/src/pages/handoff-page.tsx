import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";

import { useDocumentTitle } from "@aarogyam/app-kit";
import { BootStage, completeHandoff, useAuth, type AuthOutcome } from "@aarogyam/auth";

import { useServices } from "../clinic.js";

/**
 * Where central sign-in lands (`/auth/handoff#code=…`): redeems the one-time code on this
 * clinic's host, signs in here, then lands on Today. The loader stays up through the whole trip.
 */
export function HandoffPage() {
  useDocumentTitle("Signing in", "Aarogyam");
  const navigate = useNavigate();
  const auth = useAuth();
  const services = useServices();
  const [failed, setFailed] = useState<Extract<AuthOutcome, { ok: false }>>();
  const started = useRef(false);
  // Kept only so a dropped connection can retry; the address bar is cleared at once.
  const hash = useRef("");

  const redeem = useCallback(() => {
    setFailed(undefined);
    void completeHandoff(auth, hash.current, async (code) => {
      // Redeemed on this very host: the API refuses a code made for any other.
      const result = await services.clinic(window.location.hostname).redeemHandoff({ code });
      return result.ok ? result.value : null;
    }).then((outcome) => {
      if (outcome.ok) {
        void navigate("/today", { replace: true });
      } else {
        setFailed(outcome);
      }
    });
  }, [auth, navigate, services]);

  useEffect(() => {
    // Once per page: a code works once, so a second run would only fail.
    if (started.current) {
      return;
    }
    started.current = true;
    hash.current = window.location.hash;
    // The code leaves the address bar (and the history) at once.
    window.history.replaceState(null, "", window.location.pathname);
    redeem();
  }, [redeem]);

  const back = () => {
    void navigate("/sign-in", { replace: true });
  };
  if (failed === undefined) {
    return <BootStage text="Signing you in…" />;
  }
  // Only a dropped connection can be retried with the same code; a used one needs a new sign-in.
  const retry = failed.code === "network" ? redeem : back;
  return <BootStage text="That sign-in didn't work" failure={{ message: failed.message, onRetry: retry, onBack: back }} />;
}
