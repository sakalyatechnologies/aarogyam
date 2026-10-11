/**
 * The patient header's facts: how to reach them, who they are, and how their care is going. Contact details come as the
 * API sends them (already masked without patients.contact). Money shows only with billing.read, and stays hidden until
 * this person opens the eye: the same eye and the same setting as Today.
 */
import { Mail, Phone } from "lucide-react";
import type { ReactNode } from "react";

import type { Patient } from "@aarogyam/api-client";
import { formatDate, formatDateTime, formatRupees } from "@aarogyam/app-kit";

import { useClinic } from "../../../clinic.js";
import { formatPhone } from "../../../lib/patients.js";
import { useVisits } from "../../../queries.js";
import { MoneyEye, useShowMoney } from "../../today/v2/money.js";

function Fact({ label, children, wide = false }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <dl className={wide ? "p360-fact wide" : "p360-fact"}>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </dl>
  );
}

export function birthLine(patient: Patient): string {
  if (patient.date_of_birth == null) return patient.age_years == null ? "Not recorded" : `About ${String(patient.age_years)} years`;
  const age = patient.age_years == null ? "" : ` (${patient.birth_date_estimated ? "about " : ""}${String(patient.age_years)} y)`;
  return `${patient.birth_date_estimated ? "Estimated " : ""}${formatDate(`${patient.date_of_birth}T00:00:00Z`, "UTC")}${age}`;
}

export function PatientFacts({ patient }: { patient: Patient }) {
  const { can } = useClinic();
  const canClinical = can("clinical.read") || can("clinical.write");
  const canMoney = can("billing.read");
  const [shown] = useShowMoney();
  const visits = useVisits(canClinical ? patient.id : undefined);
  const money = (paise: number | null | undefined): string => (!shown ? "₹ ••••" : paise == null ? "—" : formatRupees(paise));
  return (
    <div className="p360-facts" role="group" aria-label="Contact and care">
      <Fact label="Mobile">
        {patient.phone == null ? (
          "Not recorded"
        ) : (
          <span className="p360-fact-line">
            <Phone aria-hidden="true" />
            <span className="mk-mono">{formatPhone(patient.phone)}</span>
          </span>
        )}
      </Fact>
      <Fact label="Email" wide>
        {patient.email == null ? (
          "Not recorded"
        ) : (
          <span className="p360-fact-line">
            <Mail aria-hidden="true" />
            <span>{patient.email}</span>
          </span>
        )}
      </Fact>
      <Fact label="Date of birth">{birthLine(patient)}</Fact>
      <Fact label="File number">
        <span className="mk-mono">{patient.number}</span>
      </Fact>
      {canClinical ? <Fact label="Visits">{visits.data === undefined ? "…" : String(visits.data.items.length)}</Fact> : null}
      <Fact label="Last visit">{patient.last_visit_at == null ? "None yet" : formatDate(patient.last_visit_at)}</Fact>
      <Fact label="Next appointment" wide>
        {patient.next_appointment == null ? "None booked" : `${formatDateTime(patient.next_appointment.starts_at)} · ${patient.next_appointment.practitioner}`}
      </Fact>
      {canMoney ? (
        <>
          <Fact label="Collected">
            <span aria-label={shown ? undefined : "Hidden"}>{money(patient.lifetime_paid_paise)}</span>
          </Fact>
          <Fact label="Pending">
            <span className="p360-fact-line">
              <span aria-label={shown ? undefined : "Hidden"} className={shown && (patient.balance_paise ?? 0) > 0 ? "p360-due" : undefined}>
                {money(patient.balance_paise)}
              </span>
              <MoneyEye what="patient money" className="p360-eye" />
            </span>
          </Fact>
        </>
      ) : null}
    </div>
  );
}
