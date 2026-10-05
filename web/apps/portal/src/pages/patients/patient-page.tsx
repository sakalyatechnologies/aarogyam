import { Eye, EyeOff, Mail, Pencil, Phone } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router";

import { patientId, type Patient, type PatientId } from "@aarogyam/api-client";
import { ApiErrorNotice, formatDate, formatDateTime, formatRupees, useDocumentTitle } from "@aarogyam/app-kit";
import { Skeleton, Tabs } from "@sakalya/ui";

import { MkCard } from "../../components/mk/index.js";
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
  return (
    <div className="mk-kv" style={{ alignItems: "center" }}>
      <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span aria-hidden="true" style={{ display: "inline-flex" }}>
          {icon}
        </span>
        <span className="mk-sr">{label}:</span>
        <b style={{ fontVariantNumeric: "tabular-nums" }}>{revealable && !shown ? masked : value}</b>
      </span>
      {revealable ? (
        <button
          type="button"
          className="mk-link"
          aria-pressed={shown}
          onClick={() => {
            setShown(!shown);
          }}
        >
          {shown ? <EyeOff aria-hidden="true" size={14} /> : <Eye aria-hidden="true" size={14} />} {shown ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
        </button>
      ) : (
        <span style={{ fontSize: 12 }}>Hidden for your role</span>
      )}
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
    <div className="mk-panel">
      <section className="mk-card" style={{ padding: 0, overflow: "hidden", marginBottom: 16 }}>
        <div className="mk-drawer-h">
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
            <div style={{ minWidth: 0 }}>
              <small>PATIENT 360</small>
              <h1>{patient.full_name}</h1>
              <div>
                {patient.number} · {ageSex(age, patient.sex, patient.birth_date_estimated)}
                {patient.status === "active" ? "" : ` · ${patient.status === "inactive" ? "Inactive" : patient.status}`}
              </div>
            </div>
            {can("patients.write") ? (
              <button
                type="button"
                className="mk-btn mk-btn-ghost"
                style={{ background: "rgba(255,255,255,.14)", borderColor: "rgba(255,255,255,.3)", color: "#fff" }}
                onClick={() => {
                  void navigate(`${patientPath(patient)}/edit`);
                }}
              >
                <Pencil aria-hidden="true" /> Edit
              </button>
            ) : null}
          </div>
        </div>
        <div style={{ padding: "8px 24px 22px" }}>
          <dl style={{ margin: 0 }}>
            <Kv label="Last visit" value={patient.last_visit_at == null ? "—" : formatDate(patient.last_visit_at)} />
            <Kv
              label="Next appointment"
              value={patient.next_appointment == null ? "—" : `${formatDateTime(patient.next_appointment.starts_at)} · ${patient.next_appointment.practitioner}`}
            />
            {/* Money is null without billing.read: a dash, never a made-up zero. */}
            <Kv label="Lifetime value" value={patient.lifetime_paid_paise == null ? "—" : formatRupees(patient.lifetime_paid_paise)} />
            <Kv label="Outstanding" value={patient.balance_paise == null ? "—" : formatRupees(patient.balance_paise)} />
          </dl>
          <div>
            {patient.phone == null ? (
              <p className="mk-hint">No phone recorded</p>
            ) : (
              <Contact icon={<Phone size={15} />} label="Phone" value={formatPhone(patient.phone)} masked={maskPhone(patient.phone)} revealable={revealable} />
            )}
            {patient.email == null ? null : (
              <Contact icon={<Mail size={15} />} label="Email" value={patient.email} masked={maskEmail(patient.email)} revealable={revealable} />
            )}
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
            <button
              type="button"
              className="mk-btn mk-btn-primary"
              style={{ flex: 1 }}
              onClick={() => {
                void navigate(`/calendar?book=1&patient=${patient.id}`);
              }}
            >
              + Follow-up
            </button>
            {/* Messaging isn't built yet: disabled, not a button that pretends. */}
            <button type="button" className="mk-btn mk-btn-ghost" style={{ flex: 1 }} disabled title="Coming soon">
              ✉ Message
            </button>
          </div>
        </div>
      </section>
      <MkCard>
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
      </MkCard>
    </div>
  );
}

function Kv({ label, value }: { label: string; value: string }) {
  return (
    <div className="mk-kv">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="mk-flabel" style={{ margin: 0 }}>
        {label}
      </dt>
      <dd style={{ margin: "2px 0 0", fontSize: 14, fontWeight: 600 }}>{value}</dd>
    </div>
  );
}
