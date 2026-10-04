import { Eye, EyeOff, Mail, Phone } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useParams } from "react-router";

import { patientId, patientNumber, type Patient, type PatientRef } from "@aarogyam/api-client";
import { ApiErrorNotice, formatDate, useDocumentTitle } from "@aarogyam/app-kit";
import { Avatar, Button, Card, EmptyState, Pill, Skeleton, Tabs } from "@sakalya/ui";

import { useClinic } from "../../clinic.js";
import { ageOn, ageSex, formatPhone, languageLabel, maskEmail, maskPhone, useTodayDate } from "../../lib/patients.js";
import { usePatient } from "../../queries.js";
import { NotFoundPage } from "../not-found-page.js";

/** The URL carries the clinic number (or ID), validated before it reaches the API. */
function parseRef(param: string | undefined): PatientRef | undefined {
  const number = patientNumber.safeParse(param);
  if (number.success) {
    return number.data;
  }
  const id = patientId.safeParse(param);
  return id.success && /^[0-9a-f-]{36}$/.test(id.data) ? id.data : undefined;
}

/** Shows a contact detail masked until asked; at a busy front desk, screens are seen by others. */
function Contact({ icon, label, value, masked }: { icon: ReactNode; label: string; value: string; masked: string }) {
  const [shown, setShown] = useState(false);
  return (
    <div className="flex items-center gap-2 text-sm">
      <span aria-hidden="true" className="text-muted [&>svg]:size-4">
        {icon}
      </span>
      <span className="sr-only">{label}:</span>
      <span className="font-semibold text-text tabular-nums">{shown ? value : masked}</span>
      <Button
        variant="ghost"
        className="px-2 py-1"
        aria-pressed={shown}
        icon={shown ? <EyeOff aria-hidden="true" className="size-4" /> : <Eye aria-hidden="true" className="size-4" />}
        onClick={() => {
          setShown(!shown);
        }}
      >
        {shown ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
      </Button>
    </div>
  );
}

/** Patient 360: who the patient is, then their record by tab. */
export function PatientPage() {
  const params = useParams();
  const ref = parseRef(params["ref"]);
  const patient = usePatient(ref);
  const { session } = useClinic();
  // Titles reach browser history, so they carry the number, never the name.
  useDocumentTitle(ref, "Patients", session.clinic.name);
  if (ref === undefined) {
    return <NotFoundPage title="We couldn't find that patient" />;
  }
  if (patient.isPending) {
    return (
      <div role="status" aria-label="Loading the patient">
        <Skeleton shape="block" />
      </div>
    );
  }
  if (patient.isError) {
    return <ApiErrorNotice title="Couldn't open this patient" error={patient.error} onRetry={() => void patient.refetch()} />;
  }
  return <PatientView patient={patient.data} />;
}

function PatientView({ patient }: { patient: Patient }) {
  const today = useTodayDate();
  const age = patient.date_of_birth == null ? null : ageOn(patient.date_of_birth, today);
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <div className="flex flex-wrap items-start gap-4">
          <Avatar name={patient.full_name} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-extrabold tracking-tight text-text">{patient.full_name}</h1>
              <Pill tone="primary">{patient.number}</Pill>
              {patient.status === "active" ? null : <Pill tone="warning">{patient.status === "inactive" ? "Inactive" : patient.status}</Pill>}
            </div>
            <p className="mt-1 text-sm text-muted">{ageSex(age, patient.sex, patient.birth_date_estimated)}</p>
            <div className="mt-3 flex flex-col gap-1">
              {patient.phone == null ? (
                <p className="text-sm text-muted">No phone recorded</p>
              ) : (
                <Contact icon={<Phone />} label="Phone" value={formatPhone(patient.phone)} masked={maskPhone(patient.phone)} />
              )}
              {patient.email == null ? null : <Contact icon={<Mail />} label="Email" value={patient.email} masked={maskEmail(patient.email)} />}
            </div>
          </div>
        </div>
      </Card>
      <Card>
        <Tabs
          label="Patient record"
          defaultValue="overview"
          items={[
            {
              value: "overview",
              label: "Overview",
              content: (
                <dl className="grid grid-cols-1 gap-4 pt-2 sm:grid-cols-2">
                  <Detail
                    label="Date of birth"
                    value={
                      patient.date_of_birth == null
                        ? "Not recorded"
                        : patient.birth_date_estimated
                          ? `Estimated (about ${String(age)} years)`
                          : formatDate(`${patient.date_of_birth}T00:00:00Z`, "UTC")
                    }
                  />
                  <Detail label="Preferred language" value={languageLabel(patient.preferred_language)} />
                  <Detail label="Registered" value={formatDate(patient.created_at)} />
                  <Detail label="Last visit" value={patient.last_visit_at == null ? "Not yet" : formatDate(patient.last_visit_at)} />
                </dl>
              ),
            },
            {
              value: "visits",
              label: "Visits",
              content: <EmptyState title="Visits come next" description="Each visit, note and treatment will appear here in order." />,
            },
            {
              value: "billing",
              label: "Billing",
              content: <EmptyState title="Billing comes next" description="Bills, payments and dues will appear here." />,
            },
          ]}
        />
      </Card>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-semibold text-muted">{label}</dt>
      <dd className="text-sm font-semibold text-text">{value}</dd>
    </div>
  );
}
