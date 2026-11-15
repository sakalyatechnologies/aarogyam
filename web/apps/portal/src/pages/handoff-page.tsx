import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";

import { useDocumentTitle } from "@aarogyam/app-kit";
import { BootStage, completeHandoff, useAuth } from "@aarogyam/auth";

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
  const [problem, setProblem] = useState<string>();
  const started = useRef(false);

  useEffect(() => {
    // Once per page: a code works once, so a second run would only fail. It is never sent again.
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
        void navigate("/today", { replace: true });
      } else {
        setProblem(outcome.message);
      }
    });
    // Runs once per mount, guarded by `started`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (problem === undefined) {
    return <BootStage text="Signing you in…" />;
  }
  // No Try again: the code is used up. Signing in again on the site makes a fresh one.
  const back = () => {
    void navigate("/sign-in", { replace: true });
  };
  return <BootStage text="That sign-in didn't work" failure={{ message: problem, onBack: back }} />;
}
