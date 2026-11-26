import { Link } from "react-router";

import type { PatientId } from "@aarogyam/api-client";

import { useClinic } from "../../clinic.js";
import { patientPath } from "../../lib/patients.js";
import { usePatientIntake } from "../../intake-queries.js";
import { IntakeSummary } from "./intake-summary.js";

/** The registration (case-paper) details on a patient's profile, with Edit. Nothing shows until some were recorded. */
export function PatientIntakeCard({ patientId }: { patientId: PatientId }) {
  const { can } = useClinic();
  const intake = usePatientIntake(patientId);
  if (intake.data === undefined || Object.keys(intake.data).length === 0) return null;
  return (
    <section aria-label="Registration details" className="mt-3 flex flex-col gap-2 rounded-2xl border border-border bg-surface px-4 py-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold text-text">Registration details</h2>
        {can("patients.write") ? (
          <Link className="text-sm font-medium text-primary-text underline" to={`${patientPath({ id: patientId })}/edit`}>
            Edit
          </Link>
        ) : null}
      </div>
      <IntakeSummary intake={intake.data} label="Registration details list" />
    </section>
  );
}
