import { HeartPulse } from "lucide-react";
import type { ReactNode } from "react";

import { AuthShell } from "@aarogyam/auth";

const POINTS = ["Sign in with a one-time email code, no password", "Each person sees only what their role allows", "Patient details never leave your clinic's records"] as const;

/** The portal's sign-in, registration and invitation pages share this frame. */
export function PortalAuthShell({ children }: { children: ReactNode }) {
  return (
    <AuthShell
      name="Aarogyam"
      tagline="Ārogyaṁ dhana sampadā"
      icon={<HeartPulse aria-hidden="true" className="size-6" />}
      headline="Your clinic's whole day, in one calm place"
      points={POINTS}
      visual="clinic"
      footer="Aarogyam · by Sakalya Technologies"
    >
      {children}
    </AuthShell>
  );
}
