import { Eye, EyeOff, Mail, Pencil, Phone } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router";

import { patientId, type Patient, type PatientId } from "@aarogyam/api-client";
import { ApiErrorNotice, formatDate, formatDateTime, formatRupees, useDocumentTitle } from "@aarogyam/app-kit";
import { Button, Card, Skeleton, Tabs } from "@sakalya/ui";

import { useClinic } from "../../clinic.js";
import { ageSex, formatPhone, languageLabel, maskEmail, maskPhone, patientPath } from "../../lib/patients.js";
import { usePatient } from "../../queries.js";
import { NotFoundPage } from "../not-found-page.js";
import { ClinicalFlagsPanel } from "./clinical-flags-panel.js";
import { DentalChartPanel } from "./dental-chart-panel.js";
import { FilesPanel } from "./files-panel.js";
import { BillsPanel, PrescriptionsPanel } from "./records-panels.js";
import { VisitsPanel } from "./visits-panel.js";

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
  const canSeeClinical = can("clinical.read") || can("clinical.write");
  // Without patients.contact the API sends contact details already masked: show them as they are.
  const revealable = can("patients.contact");
  const age = patient.age_years ?? null;
  return (
    <div className="flex flex-col gap-4">
      <Card className="overflow-hidden !p-0">
        <div className="bg-gradient-to-br from-primary-hover to-primary p-6 text-on-primary">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] tracking-[0.1em] opacity-80">PATIENT 360</p>
              <h1 className="mb-0.5 mt-1.5 text-[22px] font-bold">{patient.full_name}</h1>
              <p className="text-[13px] opacity-85">
                {patient.number} · {ageSex(age, patient.sex, patient.birth_date_estimated)}
                {patient.status === "active" ? "" : ` · ${patient.status === "inactive" ? "Inactive" : patient.status}`}
              </p>
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
        </div>
        <div className="px-6 py-5">
          <dl className="text-[13px]">
            <Kv label="Last visit" value={patient.last_visit_at == null ? "—" : formatDate(patient.last_visit_at)} />
            <Kv
              label="Next appointment"
              value={patient.next_appointment == null ? "—" : `${formatDateTime(patient.next_appointment.starts_at)} · ${patient.next_appointment.practitioner}`}
            />
            {/* Money is null without billing.read: a dash, never a made-up zero. */}
            <Kv label="Lifetime value" value={patient.lifetime_paid_paise == null ? "—" : formatRupees(patient.lifetime_paid_paise)} />
            <Kv label="Outstanding" value={patient.balance_paise == null ? "—" : formatRupees(patient.balance_paise)} />
          </dl>
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
          <div className="mt-4 flex gap-2">
            <Button
              className="flex-1 justify-center"
              onClick={() => {
                void navigate("/calendar");
              }}
            >
              + Follow-up
            </Button>
            {/* Messaging isn't built yet: disabled, not a button that pretends. */}
            <Button variant="secondary" className="flex-1 justify-center" disabled title="Coming soon">
              ✉ Message
            </Button>
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
            { value: "flags", label: "Clinical flags", content: <ClinicalFlagsPanel patientId={patient.id} /> },
            ...(canSeeClinical
              ? [
                  { value: "visits", label: "Visits", content: <VisitsPanel patientId={patient.id} /> },
                  { value: "dental-chart", label: "Dental chart", content: <DentalChartPanel patientId={patient.id} /> },
                  { value: "prescriptions", label: "Prescriptions", content: <PrescriptionsPanel patientId={patient.id} /> },
                  { value: "files", label: "Files", content: <FilesPanel patientId={patient.id} /> },
                ]
              : []),
            {
              value: "billing",
              label: "Billing",
              content: <BillsPanel patientId={patient.id} />,
            },
          ]}
        />
      </Card>
    </div>
  );
}

function Kv({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between border-b border-dashed border-border py-[9px] last:border-0">
      <dt className="text-muted">{label}</dt>
      <dd className="font-bold text-text">{value}</dd>
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
