import { Navigate } from "react-router";

import { ApiErrorNotice, useDocumentTitle } from "@aarogyam/app-kit";
import { Skeleton } from "@sakalya/ui";

import { useClinic } from "../../clinic.js";
import { MemberSetup } from "./member-setup.js";
import { OwnerWizard } from "./owner-wizard.js";
import { useClinicSetup } from "./queries.js";
import "./setup.css";

/**
 * `/setup`: the owner's short wizard, or an invited doctor's one screen. Anyone else has nothing to
 * set up and goes to Today.
 */
export function SetupPage() {
  const { session, can } = useClinic();
  useDocumentTitle("Set up", session.clinic.name);
  if (can("settings.manage")) {
    return <OwnerSetup />;
  }
  if (can("prescriptions.issue")) {
    return <MemberSetup />;
  }
  return <Navigate to="/today" replace />;
}

function OwnerSetup() {
  const setup = useClinicSetup();
  if (setup.isPending) {
    return (
      <div className="sw" role="status" aria-label="Loading setup">
        <Skeleton shape="block" />
      </div>
    );
  }
  if (setup.isError) {
    return <ApiErrorNotice title="Couldn't load the setup guide" error={setup.error} onRetry={() => void setup.refetch()} />;
  }
  if (setup.data.standing === "complete" || setup.data.standing === "dismissed") {
    // Already set up: the dashboard is where owners land.
    return <Navigate to="/today" replace />;
  }
  return <OwnerWizard setup={setup.data} />;
}
