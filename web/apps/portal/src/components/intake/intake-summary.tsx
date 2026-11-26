import type { PatientIntake } from "@aarogyam/api-client";

import { useClinic } from "../../clinic.js";
import { useIntakeOptions } from "../../intake-queries.js";
import type { IntakeChoices } from "./intake-model.js";

type Choice = IntakeChoices["blood_groups"];

const labelOf = (list: Choice | undefined, code: string | null | undefined): string | undefined =>
  code == null || code === "" ? undefined : (list?.find((c) => c.code === code)?.label ?? code);

/** The saved case-paper fields as label and value pairs; empty fields are left out. */
export function intakeRows(intake: PatientIntake | null | undefined, options: IntakeChoices | undefined): [string, string][] {
  if (intake == null) return [];
  const heard = labelOf(options?.heard_via, intake.heard_via);
  const rows: [string, string | undefined][] = [
    ["Blood group", labelOf(options?.blood_groups, intake.blood_group)],
    ["Occupation", intake.occupation ?? undefined],
    ["Mobile 2", intake.alt_phone ?? undefined],
    ["Best time to call", labelOf(options?.call_times, intake.call_time)],
    ["Emergency contact", [intake.emergency_contact_name, intake.emergency_contact_phone].filter((v) => v != null && v !== "").join(", ") || undefined],
    ["Referred by", intake.referred_by ?? undefined],
    ["Heard via", heard === undefined ? undefined : intake.heard_via_text == null || intake.heard_via_text === "" ? heard : `${heard}: ${intake.heard_via_text}`],
    ["Other conditions", intake.health_other ?? undefined],
    ["Family doctor", [intake.family_doctor_name, intake.family_doctor_phone, intake.family_doctor_address].filter((v) => v != null && v !== "").join(", ") || undefined],
    ["Pregnant", intake.pregnant === true ? (intake.due_date == null || intake.due_date === "" ? "Yes" : `Yes, due ${intake.due_date}`) : undefined],
    ["Nursing", intake.nursing === true ? "Yes" : undefined],
  ];
  return rows.filter((row): row is [string, string] => row[1] !== undefined && row[1] !== "");
}

/** A compact read-only list of the case-paper fields. Nothing shows when none were given. */
export function IntakeSummary({ intake, label = "Registration details" }: { intake: PatientIntake | null | undefined; label?: string }) {
  const { can } = useClinic();
  const options = useIntakeOptions(can("patients.write"));
  const rows = intakeRows(intake, options.data);
  if (rows.length === 0) return null;
  return (
    <dl aria-label={label} className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-sm">
      {rows.map(([name, value]) => (
        <div key={name} className="contents">
          <dt className="text-muted">{name}</dt>
          <dd className="text-text">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
