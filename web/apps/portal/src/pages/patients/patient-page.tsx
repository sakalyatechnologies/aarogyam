import { CalendarPlus, ChevronLeft, CircleCheck, Eye, EyeOff, Mail, Pencil, Phone, ShieldCheck, ShieldQuestion, Stethoscope } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";

import { apiErrorOf, patientId, type Patient, type PatientId } from "@aarogyam/api-client";
import { ApiErrorNotice, formatDate, formatDateTime, formatRupees, useDocumentTitle } from "@aarogyam/app-kit";
import { Menu, Tabs, type MenuItem } from "@sakalya/ui";

import { AppointmentActionButton, useOpenAppointment } from "../../components/appointment-action.js";
import { StartBlocked, useStartAppointmentVisit } from "../../components/start-appointment-visit.js";
import { Empty, Initials, ListRow, MkCard, Skeleton, StatusChip, Timeline } from "../../components/mk/index.js";
import { useClinic } from "../../clinic.js";
import { PatientIntakeCard } from "../../components/intake/patient-intake-card.js";
import { addressLine } from "./v2/patient-facts.js";
import { ageSex, displayName, formatPhone, languageLabel, maskEmail, maskPhone, patientPath } from "../../lib/patients.js";
import { usePatient, useSetAppointmentStatus, useStartVisit, useTimeline, useVisits } from "../../queries.js";
import { rememberPatient } from "../../lib/recent-patients.js";
import { usePlans } from "../treatment-plans/queries.js";
import { NotFoundPage } from "../not-found-page.js";
import { AllergyBanner } from "./allergy-banner.js";
import { ClinicalFlagsPanel } from "./clinical-flags-panel.js";
import { ConsentPanel } from "./consent-panel.js";
import { useConsents } from "./queries.js";
import { DentalChartPanel } from "./dental-chart-panel.js";
import { FilesPanel } from "./files-panel.js";
import { LabWorkPanel } from "./lab-work-panel.js";
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
export function Contact({ icon, label, value, masked, revealable }: { icon: ReactNode; label: string; value: string; masked: string; revealable: boolean }) {
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
  useEffect(() => {
    rememberPatient(access.org_id, patient.id);
  }, [access.org_id, patient.id]);
  // Edit and Follow-up are rare next to the visit's own step, so they sit in a menu.
  const appointment = useOpenAppointment(patient.id);
  const setStatus = useSetAppointmentStatus();
  const visits = useVisits(canSeeClinical ? patient.id : undefined);
  // A visit that ended with its appointment still in the chair and nothing to finish it (no token): a way out, so it never sticks.
  const canMarkDone =
    appointment?.status === "in_chair" && can("appointments.write") && visits.data?.items.some((v) => v.appointment_id === appointment.id && v.status === "closed") === true;
  const moreItems: MenuItem<"edit" | "follow-up" | "complete">[] = [
    ...(canMarkDone ? [{ id: "complete" as const, label: "Mark visit complete", icon: <CircleCheck aria-hidden="true" /> }] : []),
    ...(can("patients.write") ? [{ id: "edit" as const, label: "Edit", icon: <Pencil aria-hidden="true" /> }] : []),
    { id: "follow-up" as const, label: "Follow-up", icon: <CalendarPlus aria-hidden="true" /> },
  ];
  const onMore = (id: "edit" | "follow-up" | "complete") => {
    if (id === "complete" && appointment !== undefined) {
      setStatus.mutate({ id: appointment.id, change: { status: "completed" } });
      return;
    }
    void navigate(id === "edit" ? `${patientPath(patient)}/edit` : `/calendar?book=1&patient=${patient.id}`);
  };
  return (
    <div className="mk-panel">
      <Link to="/patients" className="mk-back" aria-label="Back to patients">
        <ChevronLeft aria-hidden="true" /> Patients
      </Link>
      <section className="mk-p360" aria-label="Patient summary">
        <div className="mk-p360-who">
          <Initials name={patient.full_name} size="lg" />
          <div style={{ minWidth: 0 }}>
            {/* The clinic number is the breadcrumb: it names the record without the internal "Patient 360". */}
            <div className="mk-ph-eyebrow mk-mono">{patient.number}</div>
            <h1>{displayName(patient.full_name)}</h1>
            <p>
              {ageSex(age, patient.sex, patient.birth_date_estimated)}
              {patient.status === "active" ? "" : ` · ${patient.status === "inactive" ? "Inactive" : patient.status}`}
            </p>
            <ConsentLine patientId={patient.id} />
          </div>
        </div>
        <div className="mk-p360-actions">
          <PatientNextStep patient={patient} />
          <Menu label="More" items={moreItems} onSelect={onMore} />
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
          ...(can("labs.read") ? [{ value: "labs", label: "Lab work", content: <MkCard><LabWorkPanel patientId={patient.id} /></MkCard> }] : []),
          { value: "consent", label: "Consent", content: <MkCard><ConsentPanel patientId={patient.id} /></MkCard> },
          { value: "flags", label: "Clinical flags", content: <MkCard><ClinicalFlagsPanel patientId={patient.id} /></MkCard> },
          ...(can("billing.read") ? [{ value: "billing", label: "Billing", content: <MkCard><BillsPanel patientId={patient.id} /></MkCard> }] : []),
        ]}
      />
    </div>
  );
}

/**
 * The one step the patient is at: Check in, Start visit, then Continue visit while one is open. Read from the real
 * state (today's appointment and the patient's open visit), so a visit started on the phone shows here too.
 */
function PatientNextStep({ patient }: { patient: Patient }) {
  const { can } = useClinic();
  const navigate = useNavigate();
  const canClinical = can("clinical.read") || can("clinical.write");
  const visits = useVisits(canClinical ? patient.id : undefined);
  const appointment = useOpenAppointment(patient.id);
  const startVisit = useStartVisit(patient.id);
  const startAppointmentVisit = useStartAppointmentVisit();
  const [error, setError] = useState<string | undefined>(undefined);
  const open = visits.data?.items.find((v) => v.status === "open");
  const visitPage = (id: string) => `${patientPath(patient)}/visits/${encodeURIComponent(id)}`;
  if (open !== undefined) {
    return (
      <>
        <span className="mk-hint" role="status">
          Visit in progress
        </span>
        <Link to={visitPage(open.id)} className="mk-btn mk-btn-primary">
          <Stethoscope aria-hidden="true" /> Continue visit
        </Link>
      </>
    );
  }
  if (visits.isPending && canClinical) return null;
  const finished = appointment !== undefined && visits.data?.items.some((v) => v.appointment_id === appointment.id && v.status === "closed");
  if (finished === true) {
    return <span className="mk-hint">Visit finished, payment pending</span>;
  }
  // Checking in is the desk's step; and without clinical.write the desk's only step left is seating the patient.
  if (appointment !== undefined && (appointment.status === "booked" || appointment.status === "confirmed" || !can("clinical.write"))) {
    return <AppointmentActionButton appointment={appointment} />;
  }
  if (!can("clinical.write")) return null;
  const start = () => {
    setError(undefined);
    const onError = (thrown: unknown) => {
      setError(thrown instanceof StartBlocked ? thrown.message : (apiErrorOf(thrown)?.message ?? "Couldn't start a visit."));
    };
    if (appointment !== undefined) {
      startAppointmentVisit.mutateAsync(appointment).then(() => undefined, onError);
    } else {
      startVisit.mutate({}, { onSuccess: (visit) => void navigate(visitPage(visit.id)), onError });
    }
  };
  const pending = startVisit.isPending || startAppointmentVisit.isPending;
  return (
    <>
      <button type="button" className="mk-btn mk-btn-primary" disabled={pending} onClick={start}>
        <Stethoscope aria-hidden="true" /> {pending ? "Starting…" : "Start visit"}
      </button>
      {error === undefined ? null : (
        <span role="alert" className="mk-hint" style={{ color: "var(--red)" }}>
          {error}
        </span>
      )}
    </>
  );
}

/** Whether the patient's consent to care is recorded and still stands (from their consent records). */
export function ConsentLine({ patientId }: { patientId: PatientId }) {
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
            {addressLine(patient) === undefined ? null : <p className="mk-hint">{addressLine(patient)}</p>}
          </div>
        </MkCard>
        <PatientIntakeCard patientId={patient.id} />
        <PatientAppCard patientId={patient.id} />
      </div>
    </div>
  );
}

/** The active treatment plan: title, progress and the next items. Read-only; plans are edited on the visit. */
export function CarePlan({ patientId }: { patientId: PatientId }) {
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
export function RecentHistory({ patientId }: { patientId: PatientId }) {
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

export function Kv({ label, value }: { label: string; value: string }) {
  return (
    <div className="mk-kv">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
