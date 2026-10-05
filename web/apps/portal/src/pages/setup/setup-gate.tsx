import { lazy, Suspense, type ReactNode } from "react";

import { useAuth } from "@aarogyam/auth";
import { Button, Skeleton } from "@sakalya/ui";

import { useClinic } from "../../clinic.js";
import { useClinicSetup } from "./queries.js";

const SetupPage = lazy(() => import("./setup-page.js").then((m) => ({ default: m.SetupPage })));

/**
 * Where an owner lands. Until the clinic's setup is finished (every step done or skipped) the owner
 * sees the setup and nothing else: no sidebar, no dashboard, whatever address they opened. Once the
 * last step is saved the dashboard appears. Clinics already complete or dismissed, and everyone who
 * cannot change settings (doctors, front desk), go straight through. If the setup can't be read the
 * owner is let in rather than locked out.
 */
export function SetupGate({ children }: { children: ReactNode }) {
  const { can } = useClinic();
  if (!can("settings.manage")) {
    return children;
  }
  return <OwnerGate>{children}</OwnerGate>;
}

function OwnerGate({ children }: { children: ReactNode }) {
  const setup = useClinicSetup();
  const { session } = useClinic();
  const auth = useAuth();
  if (setup.isPending) {
    return (
      <div className="p-6" role="status" aria-label="Loading setup">
        <Skeleton shape="block" />
      </div>
    );
  }
  if (setup.isError || (setup.data.standing !== "new" && setup.data.standing !== "in_progress")) {
    return children;
  }
  return (
    <main className="sw-only">
      <header className="sw-only-head">
        <b>{session.clinic.name}</b>
        <Button variant="ghost" onClick={() => void auth.signOut()}>
          Sign out
        </Button>
      </header>
      <Suspense fallback={<Skeleton shape="block" />}>
        <SetupPage />
      </Suspense>
    </main>
  );
}
