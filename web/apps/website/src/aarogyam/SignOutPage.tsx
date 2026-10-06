// Aarogyam-owned. Where the console and clinic hosts send people after they sign out: ends this
// site's own session too (otherwise opening the site would sign them straight back in), then
// shows the sign-in page.
import { useEffect, useState } from "react";

import { signOutEverywhere } from "./auth";
import { SignInPage } from "./SignInPage";

export function SignOutPage({ onBack, onRegister }: { onBack: () => void; onRegister: () => void }) {
  const [done, setDone] = useState(false);
  useEffect(() => {
    void signOutEverywhere().then(() => setDone(true));
  }, []);
  // The sign-in page checks for a stored session on load, so it waits until this one is gone.
  return done ? <SignInPage onBack={onBack} onRegister={onRegister} /> : null;
}
