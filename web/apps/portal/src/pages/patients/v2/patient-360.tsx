import { CalendarPlus, ChevronLeft, Mail, Pencil } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";

import { patientId, type Patient, type PatientId } from "@aarogyam/api-client";
import { ApiErrorNotice, formatDate, formatRupees, useDocumentTitle } from "@aarogyam/app-kit";

import { AppointmentActionButton, isOpenAppointment } from "../../../components/appointment-action.js";
import { Initials, Skeleton, Tag } from "../../../components/mk/index.js";
import { SkeletonRows } from "../../../components/skeleton-rows.js";
import { useClinic } from "../../../clinic.js";
import { ageSex, displayName, patientPath } from "../../../lib/patients.js";
import { rememberPatient } from "../../../lib/recent-patients.js";
import { usePatient, useToday } from "../../../queries.js";
import { NotFoundPage } from "../../not-found-page.js";
import { AllergyBanner } from "../allergy-banner.js";
import { ConsentLine } from "../patient-page.js";
import { ActionBar } from "./action-bar.js";
import { Celebration } from "./celebration.js";
import { PillButton, Pills } from "./kit.js";
import { ConsoleLayout, StageLayout, TabsLayout, type LayoutProps } from "./layouts.js";
import { P360_LAYOUTS, useP360Layout, type P360Layout } from "./use-layout.js";
import { VisitSessionProvider, type FinishedVisit } from "./visit-session.js";
import "./p360.css";

/** The URL carries the patient's ID, validated before it reaches the API. */
function parseId(param: string | undefined): PatientId | undefined {
  const id = patientId.safeParse(param);
  return id.success ? id.data : undefined;
}

/** Patient 360 in the new look: one header, one action bar, and the same blocks in the layout this person chose. */
export function Patient360() {
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
      <div className="p360" role="status" aria-label="Loading the patient">
        <div className="p360-head" aria-hidden="true">
          <Skeleton shape="circle" style={{ width: 64, height: 64 }} />
          <div style={{ flex: 1 }}>
            <Skeleton shape="line" style={{ width: 220, height: 26, borderRadius: 10 }} />
            <Skeleton shape="line" style={{ width: 160, marginTop: 10 }} />
          </div>
        </div>
        <SkeletonRows count={3} tall label="Loading the patient's details" />
      </div>
    );
  }
  if (patient.isError) {
    return <ApiErrorNotice title="Couldn't open this patient" error={patient.error} onRetry={() => void patient.refetch()} />;
  }
  return (
    <VisitSessionProvider patientId={patient.data.id}>
      <Patient360View patient={patient.data} />
    </VisitSessionProvider>
  );
}

function Patient360View({ patient }: { patient: Patient }) {
  const { can, access, session } = useClinic();
  const navigate = useNavigate();
  const [layout, setLayout] = useP360Layout(session.user.id);
  const [finished, setFinished] = useState<FinishedVisit | undefined>(undefined);
  const canClinical = can("clinical.read") || can("clinical.write");
  // ?tab=prescriptions (the command palette and old links) lands on the past prescriptions.
  const [params] = useSearchParams();
  const showPastRx = params.get("tab") === "prescriptions" && canClinical;
  const today = useToday(can("appointments.read"));
  const todayAppointment = today.data?.appointments.find((a) => a.patient.id === patient.id && isOpenAppointment(a.status));
  useEffect(() => {
    rememberPatient(access.org_id, patient.id);
  }, [access.org_id, patient.id]);

  const props: LayoutProps = { patient, canClinical, showPastRx };
  return (
    <div className="p360">
      <div className="p360-top">
        <Link to="/patients" className="mk-back" aria-label="Back to patients">
          <ChevronLeft aria-hidden="true" /> All patients
        </Link>
        <div className="p360-switch">
          <span aria-hidden="true">Layout</span>
          <Pills<P360Layout> label="Layout" options={P360_LAYOUTS} value={layout} onChange={setLayout} />
        </div>
      </div>

      <section className="p360-head" aria-label="Patient summary">
        <Initials name={patient.full_name} size="lg" />
        <div className="p360-head-who">
          <div className="p360-eyebrow mk-mono">{patient.number}</div>
          <h1>{displayName(patient.full_name)}</h1>
          <p className="p360-line">
            {ageSex(patient.age_years ?? null, patient.sex, patient.birth_date_estimated)}
            {" · "}Last visit {patient.last_visit_at == null ? "—" : formatDate(patient.last_visit_at)}
            {" · "}Next {patient.next_appointment == null ? "—" : formatDate(patient.next_appointment.starts_at)}
          </p>
          <div className="p360-tags">
            <ConsentLine patientId={patient.id} />
            {patient.status === "active" ? null : <Tag tone="wait">{patient.status === "inactive" ? "Inactive" : patient.status}</Tag>}
            {/* Money only with billing.read; a missing balance shows nothing rather than a made-up zero. */}
            {can("billing.read") && patient.balance_paise != null && patient.balance_paise > 0 ? <Tag tone="wait">Due {formatRupees(patient.balance_paise)}</Tag> : null}
          </div>
        </div>
        <div className="p360-head-actions">
          {todayAppointment === undefined ? null : <AppointmentActionButton appointment={todayAppointment} />}
          {can("patients.write") ? (
            <PillButton
              variant="ghost"
              icon={<Pencil aria-hidden="true" />}
              onClick={() => {
                void navigate(`${patientPath(patient)}/edit`);
              }}
            >
              Edit
            </PillButton>
          ) : null}
          {/* Messaging isn't built yet: disabled, not a button that pretends. */}
          <PillButton variant="ghost" disabled title="Coming soon" icon={<Mail aria-hidden="true" />}>
            Message
          </PillButton>
          <PillButton
            variant="ghost"
            icon={<CalendarPlus aria-hidden="true" />}
            onClick={() => {
              void navigate(`/calendar?book=1&patient=${patient.id}`);
            }}
          >
            Follow-up
          </PillButton>
        </div>
      </section>

      <AllergyBanner patientId={patient.id} />

      {layout === "console" ? <ConsoleLayout {...props} /> : layout === "stage" ? <StageLayout {...props} /> : <TabsLayout {...props} />}

      <ActionBar onFinished={setFinished} />
      {finished === undefined ? null : (
        <Celebration
          finished={finished}
          patient={patient}
          onClose={() => {
            setFinished(undefined);
          }}
        />
      )}
    </div>
  );
}
