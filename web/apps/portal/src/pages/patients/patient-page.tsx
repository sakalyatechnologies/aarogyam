import { CalendarPlus, ChevronLeft, Eye, EyeOff, Mail, Pencil, Phone, ShieldCheck, ShieldQuestion } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";

import { patientId, type Patient, type PatientId } from "@aarogyam/api-client";
import { ApiErrorNotice, formatDate, formatDateTime, formatRupees, useDocumentTitle } from "@aarogyam/app-kit";
import { Tabs } from "@sakalya/ui";

import { AppointmentActionButton, isOpenAppointment } from "../../components/appointment-action.js";
import { Empty, Initials, ListRow, MkCard, Skeleton, StatusChip, Timeline } from "../../components/mk/index.js";
import { useClinic } from "../../clinic.js";
import { ageSex, formatPhone, languageLabel, maskEmail, maskPhone, patientPath } from "../../lib/patients.js";
import { usePatient, useTimeline, useToday } from "../../queries.js";
import { rememberPatient } from "../../lib/recent-patients.js";
import { usePlans } from "../treatment-plans/queries.js";
import { NotFoundPage } from "../not-found-page.js";
import { AllergyBanner } from "./allergy-banner.js";
import { ClinicalFlagsPanel } from "./clinical-flags-panel.js";
import { ConsentPanel } from "./consent-panel.js";
import { useConsents } from "./queries.js";
import { DentalChartPanel } from "./dental-chart-panel.js";
import { FilesPanel } from "./files-panel.js";
import { NotesPanel } from "./notes-panel.js";
import { PatientAppCard } from "./patient-app-card.js";
import { BillsPanel, PrescriptionsPanel } from "./records-panels.js";
import { VisitsPanel } from "./visits-panel.js";
import { SkeletonRows } from "../../components/skeleton-rows.js";

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
      <div className="flex flex-col gap-4">
        <div className="mk-p360" role="status" aria-label="Loading the patient">
          <div className="mk-p360-who" aria-hidden="true">
            <Skeleton shape="circle" style={{ width: 64, height: 64 }} />
            <div style={{ flex: 1 }}>
              <Skeleton shape="line" style={{ width: 220, height: 26, borderRadius: 10 }} />
              <Skeleton shape="line" style={{ width: 160, marginTop: 10 }} />
            </div>
          </div>
        </div>
        <div className="flex gap-2" aria-hidden="true">
          {Array.from({ length: 6 }, (_, index) => (
            <Skeleton key={index} shape="line" style={{ width: 84, height: 36, borderRadius: 10 }} />
          ))}
        </div>
        <SkeletonRows count={3} tall label="Loading the patient's details" />
      </div>
    );
  }
  if (patient.isError) {
    return <ApiErrorNotice title="Couldn't open this patient" error={patient.error} onRetry={() => void patient.refetch()} />;
  }
  return <PatientView patient={patient.data} />;
}

function PatientView({ patient }: { patient: Patient }) {
  const { can, access } = useClinic();
  const navigate = useNavigate();
  const canSeeClinical = can("clinical.read") || can("clinical.write");
  // ?tab=prescriptions opens the Rx tab (the command palette and old links use it).
  const [params] = useSearchParams();
  const requestedTab = params.get("tab") === "prescriptions" && canSeeClinical ? "prescriptions" : "overview";
  // Without patients.contact the API sends contact details already masked: show them as they are.
  const revealable = can("patients.contact");
  const age = patient.age_years ?? null;
  // Today's appointment for this patient that can still move along: the desk or the doctor takes the next step from here.
  const today = useToday(can("appointments.read"));
  const todayAppointment = today.data?.appointments.find((a) => a.patient.id === patient.id && isOpenAppointment(a.status));
  useEffect(() => {
    rememberPatient(access.org_id, patient.id);
  }, [access.org_id, patient.id]);
  return (
    <div className="mk-panel">
      <Link to="/patients" className="mk-back" aria-label="Back to patients">
        <ChevronLeft aria-hidden="true" /> Patients
      </Link>
      <section className="mk-p360" aria-label="Patient summary">
        <div className="mk-p360-who">
          <Initials name={patient.full_name} size="lg" />
          <div style={{ minWidth: 0 }}>
            <div className="mk-ph-eyebrow">Patient 360</div>
            <h1>{patient.full_name}</h1>
            <p>
              {ageSex(age, patient.sex, patient.birth_date_estimated)} · <span className="mk-mono">{patient.number}</span>
              {patient.status === "active" ? "" : ` · ${patient.status === "inactive" ? "Inactive" : patient.status}`}
            </p>
            <ConsentLine patientId={patient.id} />
          </div>
        </div>
        <div className="mk-p360-actions">
          {todayAppointment === undefined ? null : <AppointmentActionButton appointment={todayAppointment} />}
          {can("patients.write") ? (
            <button
              type="button"
              className="mk-btn mk-btn-ghost"
              onClick={() => {
                void navigate(`${patientPath(patient)}/edit`);
              }}
            >
              <Pencil aria-hidden="true" /> Edit
            </button>
          ) : null}
          {/* Messaging isn't built yet: disabled, not a button that pretends. */}
          <button type="button" className="mk-btn mk-btn-ghost" disabled title="Coming soon">
            <Mail aria-hidden="true" /> Message
          </button>
          <button
            type="button"
            className="mk-btn mk-btn-primary"
            onClick={() => {
              void navigate(`/calendar?book=1&patient=${patient.id}`);
            }}
          >
            <CalendarPlus aria-hidden="true" /> Follow-up
          </button>
        </div>
      </section>
      <AllergyBanner patientId={patient.id} />
      <Tabs
        key={requestedTab}
        className="mk-tabs4"
        label="Patient record"
        defaultValue={requestedTab}
        items={[
          {
            value: "overview",
            label: "Overview",
            content: <Overview patient={patient} canSeeClinical={canSeeClinical} revealable={revealable} />,
          },
          ...(canSeeClinical
            ? [
                { value: "dental-chart", label: "Chart", content: <MkCard><DentalChartPanel patientId={patient.id} /></MkCard> },
                { value: "visits", label: "Visits", content: <MkCard><VisitsPanel patientId={patient.id} /></MkCard> },
                { value: "prescriptions", label: "Rx", content: <MkCard><PrescriptionsPanel patientId={patient.id} /></MkCard> },
                { value: "files", label: "Files", content: <MkCard><FilesPanel patientId={patient.id} /></MkCard> },
                { value: "notes", label: "Notes", content: <MkCard><NotesPanel patientId={patient.id} /></MkCard> },
              ]
            : []),
          { value: "consent", label: "Consent", content: <MkCard><ConsentPanel patientId={patient.id} /></MkCard> },
          { value: "flags", label: "Clinical flags", content: <MkCard><ClinicalFlagsPanel patientId={patient.id} /></MkCard> },
          ...(can("billing.read") ? [{ value: "billing", label: "Billing", content: <MkCard><BillsPanel patientId={patient.id} /></MkCard> }] : []),
        ]}
      />
    </div>
  );
}

/** Whether the patient's consent to care is recorded and still stands (from their consent records). */
function ConsentLine({ patientId }: { patientId: PatientId }) {
  const consents = useConsents(patientId);
  if (consents.data === undefined) {
    return null;
  }
  const care = consents.data.items.some((c) => c.purpose === "care" && c.status === "given");
  return (
    <span className={`mk-consent ${care ? "ok" : ""}`}>
      {care ? <ShieldCheck aria-hidden="true" /> : <ShieldQuestion aria-hidden="true" />}
      {care ? "Consent recorded" : "No consent recorded"}
    </span>
  );
}

function Overview({ patient, canSeeClinical, revealable }: { patient: Patient; canSeeClinical: boolean; revealable: boolean }) {
  const { can } = useClinic();
  const age = patient.age_years ?? null;
  return (
    <div className="mk-p360-grid">
      <div className="mk-stack">
        {canSeeClinical ? <CarePlan patientId={patient.id} /> : null}
        {canSeeClinical ? <RecentHistory patientId={patient.id} /> : null}
        <MkCard title="Lab work">
          <Empty art="lab" title="No lab work in progress">
            Crowns, aligners and other lab orders will show their status here.
          </Empty>
        </MkCard>
      </div>
      <div className="mk-stack">
        <MkCard title="Details">
          <dl style={{ margin: 0 }}>
            <Kv
              label="Date of birth"
              value={
                patient.date_of_birth == null
                  ? "Not recorded"
                  : patient.birth_date_estimated
                    ? `Estimated (about ${String(age)} years)`
                    : formatDate(`${patient.date_of_birth}T00:00:00Z`, "UTC")
              }
            />
            <Kv label="Preferred language" value={languageLabel(patient.preferred_language)} />
            <Kv label="Registered" value={formatDate(patient.created_at)} />
            <Kv label="Last visit" value={patient.last_visit_at == null ? "—" : formatDate(patient.last_visit_at)} />
            <Kv
              label="Next appointment"
              value={patient.next_appointment == null ? "—" : `${formatDateTime(patient.next_appointment.starts_at)} · ${patient.next_appointment.practitioner}`}
            />
            {/* Money only with billing.read; null still shows a dash, never a made-up zero. */}
            {can("billing.read") ? (
              <>
                <Kv label="Lifetime value" value={patient.lifetime_paid_paise == null ? "—" : formatRupees(patient.lifetime_paid_paise)} />
                <Kv label="Outstanding" value={patient.balance_paise == null ? "—" : formatRupees(patient.balance_paise)} />
              </>
            ) : null}
          </dl>
          <div style={{ marginTop: 6 }}>
            {patient.phone == null ? (
              <p className="mk-hint">No phone recorded</p>
            ) : (
              <Contact icon={<Phone size={15} />} label="Phone" value={formatPhone(patient.phone)} masked={maskPhone(patient.phone)} revealable={revealable} />
            )}
            {patient.email == null ? null : (
              <Contact icon={<Mail size={15} />} label="Email" value={patient.email} masked={maskEmail(patient.email)} revealable={revealable} />
            )}
          </div>
        </MkCard>
        <PatientAppCard patientId={patient.id} />
      </div>
    </div>
  );
}

/** The active treatment plan: title, progress and the next items. Read-only; plans are edited on the visit. */
function CarePlan({ patientId }: { patientId: PatientId }) {
  const plans = usePlans(patientId);
  if (plans.isPending) {
    return <Skeleton shape="block" style={{ height: 150 }} />;
  }
  const plan = plans.data?.items.find((p) => p.status === "in_progress" || p.status === "accepted") ?? plans.data?.items.find((p) => p.status === "proposed");
  if (plan === undefined) {
    return (
      <MkCard title="Active care plan">
        <Empty art="plan" title="No active care plan">
          Propose a treatment plan from a visit; its progress shows here.
        </Empty>
      </MkCard>
    );
  }
  const items = plan.items.filter((item) => item.status !== "cancelled");
  const done = items.filter((item) => item.status === "done").length;
  const pct = items.length === 0 ? 0 : Math.round((done / items.length) * 100);
  return (
    <section className="mk-card mk-careplan" aria-label="Active care plan">
      <div className="mk-ph-eyebrow">Active care plan</div>
      <div className="mk-card-h" style={{ marginTop: 8 }}>
        <h2>{plan.title}</h2>
        <StatusChip tone={plan.status === "proposed" ? "confirmed" : "ready"}>{plan.status === "proposed" ? "Proposed" : plan.status === "accepted" ? "Accepted" : "In progress"}</StatusChip>
      </div>
      <p className="mk-hint">
        {plan.clinician.name} · {done} of {items.length} done · estimate {formatRupees(plan.estimate_paise)}
      </p>
      <div className="mk-meter" role="meter" aria-label="Plan progress" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <i style={{ width: `${String(pct)}%` }} />
      </div>
      <ul className="mk-list" aria-label="Plan items" style={{ marginTop: 10 }}>
        {items.slice(0, 4).map((item) => (
          <ListRow
            key={item.id}
            title={item.name}
            subtitle={item.tooth == null ? `Phase ${String(item.phase)}` : `Tooth ${String(item.tooth)} · Phase ${String(item.phase)}`}
            trailing={<StatusChip tone={item.status === "done" ? "done" : item.status === "accepted" ? "ready" : "confirmed"}>{item.status === "done" ? "Done" : item.status === "accepted" ? "Accepted" : "Proposed"}</StatusChip>}
          />
        ))}
      </ul>
    </section>
  );
}

/** The last few events on the patient's timeline. */
function RecentHistory({ patientId }: { patientId: PatientId }) {
  const timeline = useTimeline(patientId);
  return (
    <MkCard title="Recent clinical history">
      {timeline.isPending ? (
        <SkeletonRows count={3} label="Loading history" />
      ) : timeline.isError || timeline.data.items.length === 0 ? (
        <Empty art="notes" title="No history yet">
          Visits, notes, procedures and files appear here as they are recorded.
        </Empty>
      ) : (
        <Timeline
          label="Recent clinical history"
          items={timeline.data.items.slice(0, 5).map((event) => ({
            id: event.id,
            when: formatDate(event.at),
            title: event.title,
            detail: [event.detail, event.by?.name].filter((part) => part != null && part !== "").join(" · ") || undefined,
          }))}
        />
      )}
    </MkCard>
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
