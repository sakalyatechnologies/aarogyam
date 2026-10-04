import { Eye, EyeOff, Mail, Pencil, Phone } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router";

import { patientId, type Patient, type PatientId } from "@aarogyam/api-client";
import { ApiErrorNotice, formatDate, useDocumentTitle } from "@aarogyam/app-kit";
import { Avatar, Button, Card, EmptyState, Pill, Skeleton, Tabs } from "@sakalya/ui";

import { useClinic } from "../../clinic.js";
import { ageSex, formatPhone, languageLabel, maskEmail, maskPhone, patientPath } from "../../lib/patients.js";
import { usePatient } from "../../queries.js";
import { NotFoundPage } from "../not-found-page.js";

/** The URL carries the patient's ID, validated before it reaches the API. */
function parseId(param: string | undefined): PatientId | undefined {
  const id = patientId.safeParse(param);
  return id.success ? id.data : undefined;
}

/** Shows a contact detail masked until asked; at a busy front desk, screens are seen by others. */
function Contact({ icon, label, value, masked, revealable }: { icon: ReactNode; label: string; value: string; masked: string; revealable: boolean }) {
  const [shown, setShown] = useState(false);
  if (!revealable) {
    return (
      <div className="flex items-center gap-2 text-sm">
        <span aria-hidden="true" className="text-muted [&>svg]:size-4">
          {icon}
        </span>
        <span className="sr-only">{label}:</span>
        <span className="font-semibold text-text tabular-nums">{value}</span>
        <span className="text-xs text-muted">Hidden for your role</span>
      </div>
    );
  }
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
  const id = parseId(params["id"]);
  const patient = usePatient(id);
  const { session } = useClinic();
  // Titles reach browser history, so they carry the number, never the name.
  useDocumentTitle(patient.data?.number, "Patients", session.clinic.name);
  if (id === undefined) {
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
  const { can } = useClinic();
  const navigate = useNavigate();
  // Without patients.contact the API sends contact details already masked: show them as they are.
  const revealable = can("patients.contact");
  const age = patient.age_years ?? null;
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
                <Contact icon={<Phone />} label="Phone" value={formatPhone(patient.phone)} masked={maskPhone(patient.phone)} revealable={revealable} />
              )}
              {patient.email == null ? null : (
                <Contact icon={<Mail />} label="Email" value={patient.email} masked={maskEmail(patient.email)} revealable={revealable} />
              )}
            </div>
          </div>
          {can("patients.write") ? (
            <Button
              variant="secondary"
              icon={<Pencil aria-hidden="true" className="size-4" />}
              onClick={() => {
                void navigate(`${patientPath(patient)}/edit`);
              }}
            >
              Edit
            </Button>
          ) : null}
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
              value: "flags",
              label: "Clinical flags",
              content: (
                <EmptyState
                  title="No clinical flags recorded yet"
                  description="Allergies and conditions will show here, prominently, once visits land in M4. Front desk will still see that a flag exists, even without clinical detail."
                />
              ),
            },
            {
              value: "visits",
              label: "Visits",
              content: <EmptyState title="No visits yet" description="Each visit, note and treatment will appear here in order, once visits land in M4." />,
            },
            {
              value: "billing",
              label: "Billing",
              content: <EmptyState title="No bills yet" description="Bills, payments and dues will appear here, once billing lands in M5." />,
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
