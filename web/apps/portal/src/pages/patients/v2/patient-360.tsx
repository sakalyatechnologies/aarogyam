import { CalendarPlus, ChevronLeft, CircleCheck, History, MessageCircle, Pencil } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useRef } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router";

import { patientId, type Patient, type PatientId } from "@aarogyam/api-client";
import { ApiErrorNotice, useDocumentTitle } from "@aarogyam/app-kit";
import { Menu, type MenuItem } from "@sakalya/ui";

import { AppointmentActionButton } from "../../../components/appointment-action.js";
import { Initials, Skeleton, Tag } from "../../../components/mk/index.js";
import { SkeletonRows } from "../../../components/skeleton-rows.js";
import { useClinic } from "../../../clinic.js";
import { ageSex, displayName, patientPath } from "../../../lib/patients.js";
import { rememberPatient } from "../../../lib/recent-patients.js";
import { useClinicalFlags, usePatient, useSetAppointmentStatus, useVisits } from "../../../queries.js";
import { NotFoundPage } from "../../not-found-page.js";
import { ConsentLine } from "../patient-page.js";
import { Celebration } from "./celebration.js";
import { PatientIntakeCard } from "../../../components/intake/patient-intake-card.js";
import { usePatientIntake, useIntakeOptions } from "../../../intake-queries.js";
import { PatientFacts } from "./patient-facts.js";
import { ConsoleLayout, StageLayout, TabsLayout, type LayoutProps } from "./layouts.js";
import { useP360Layout } from "./use-layout.js";
import { VisitBar } from "./visit-bar.js";
import { VisitSessionProvider, useVisitSession } from "./visit-session.js";
import { useHistoryStyle } from "./history/history-style.js";
import "./p360.css";

const HistoryOverlay = lazy(() => import("./history/history-overlay.js").then((m) => ({ default: m.HistoryOverlay })));

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
  const { can, access, session: auth } = useClinic();
  const navigate = useNavigate();
  // The layout is chosen in Settings, My profile.
  const [layout] = useP360Layout(auth.user.id);
  const session = useVisitSession();
  const canClinical = can("clinical.read") || can("clinical.write");
  // ?tab=prescriptions (the command palette and old links) lands on the past prescriptions.
  const [params] = useSearchParams();
  const showPastRx = params.get("tab") === "prescriptions" && canClinical;
  useEffect(() => {
    rememberPatient(access.org_id, patient.id);
  }, [access.org_id, patient.id]);

  // The desk has no visit bar (it needs clinical.write), so its step (Check in, Seat) sits in the header instead.
  const appointment = session.appointment;
  const setStatus = useSetAppointmentStatus();
  // A visit that ended with its appointment still in the chair and nothing to finish it (no token): a way out, so it never sticks.
  const canMarkDone = appointment?.status === "in_chair" && session.finishedVisit !== undefined && can("appointments.write");

  const phone = patient.phone ?? "";
  const moreItems: MenuItem<"edit" | "message" | "follow-up" | "complete">[] = [
    ...(canMarkDone ? [{ id: "complete" as const, label: "Mark visit complete", icon: <CircleCheck aria-hidden="true" /> }] : []),
    ...(can("patients.write") ? [{ id: "edit" as const, label: "Edit", icon: <Pencil aria-hidden="true" /> }] : []),
    ...(can("patients.contact") && phone !== "" ? [{ id: "message" as const, label: "Message", icon: <MessageCircle aria-hidden="true" /> }] : []),
    { id: "follow-up" as const, label: "Follow-up", icon: <CalendarPlus aria-hidden="true" /> },
  ];
  const onMore = (id: "edit" | "message" | "follow-up" | "complete") => {
    if (id === "complete" && appointment !== undefined) setStatus.mutate({ id: appointment.id, change: { status: "completed" } });
    else if (id === "edit") void navigate(`${patientPath(patient)}/edit`);
    else if (id === "follow-up") void navigate(`/calendar?book=1&patient=${patient.id}`);
    else {
      const digits = phone.replace(/\D/g, "");
      globalThis.open(`https://wa.me/${digits.length === 10 ? `91${digits}` : digits}`, "_blank", "noopener,noreferrer");
    }
  };

  const props: LayoutProps = { patient, canClinical, showPastRx };
  const canHistory = can("clinical.read");
  return (
    <div className="p360">
      <div className="p360-top">
        <Link to="/patients" className="mk-back" aria-label="Back to patients">
          <ChevronLeft aria-hidden="true" /> All patients
        </Link>
      </div>

      <section className="p360-head" aria-label="Patient summary">
        <Initials name={patient.full_name} size="md" />
        <div className="p360-head-who">
          <h1>{displayName(patient.full_name)}</h1>
          <div className="p360-meta">
          <p className="p360-line">
            {ageSex(patient.age_years ?? null, patient.sex, patient.birth_date_estimated)}
          </p>
          <div className="p360-tags">
            <AllergyTag patientId={patient.id} />
            <ConsentLine patientId={patient.id} />
            <IntakeChips patientId={patient.id} />
            {patient.status === "active" ? null : <Tag tone="wait">{patient.status === "inactive" ? "Inactive" : patient.status}</Tag>}
          </div>
          </div>
        </div>
        <div className="p360-head-actions">
          {canHistory ? <HistoryButton patientId={patient.id} /> : null}
          {!can("clinical.write") && appointment !== undefined ? <AppointmentActionButton appointment={appointment} /> : null}
          <Menu label="More" items={moreItems} onSelect={onMore} />
        </div>
        <PatientFacts patient={patient} />
        <PatientIntakeCard patientId={patient.id} />
      </section>

      <VisitBar />

      {layout === "console" ? <ConsoleLayout {...props} /> : layout === "stage" ? <StageLayout {...props} /> : <TabsLayout {...props} />}

      {session.celebrating && session.ended !== undefined ? <Celebration finished={session.ended} patient={patient} onClose={session.closeCelebration} /> : null}
    </div>
  );
}

/** Blood group and the medical history from the case paper, as small chips under the name. Nothing shows without an intake. */
function IntakeChips({ patientId }: { patientId: PatientId }) {
  const { can } = useClinic();
  const intake = usePatientIntake(patientId);
  const options = useIntakeOptions(can("patients.write"));
  const data = intake.data;
  if (data === undefined) return null;
  const blood = data.blood_group == null || data.blood_group === "" ? undefined : (options.data?.blood_groups.find((g) => g.code === data.blood_group)?.label ?? data.blood_group);
  const medical = data.health_other == null || data.health_other === "" ? undefined : data.health_other;
  if (blood === undefined && medical === undefined) return null;
  return (
    <>
      {blood === undefined ? null : <Tag>{`Blood group ${blood}`}</Tag>}
      {medical === undefined ? null : <Tag tone="wait">{`Medical: ${medical}`}</Tag>}
    </>
  );
}

/** A dialog that is open now; drawers that stay mounted while closed carry aria-hidden. */
export const OPEN_DIALOG = "[role='dialog']:not([aria-hidden='true']), [role='alertdialog']:not([aria-hidden='true'])";

/** Typing a letter there must never leave the page. */
function typing(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.closest("input, textarea, select, [contenteditable='true'], [role='textbox'], [role='combobox']") !== null;
}

/**
 * "History · N visits": opens the full-page history. H opens it too, except while typing, with a modifier, during IME
 * composition or when a dialog is open (WCAG 2.1.4). The count comes from the visit list the facts already load.
 */
function HistoryButton({ patientId: id }: { patientId: PatientId }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [search, setSearch] = useSearchParams();
  const style = useHistoryStyle();
  const ref = useRef<HTMLButtonElement>(null);
  const count = useVisits(id).data?.items.length;
  const base = patientPath({ id });
  const to = `${base}/history`;
  const overlayOpen = search.get("history") === "1";
  // The saved style: the full page navigates; the pop-up and the story open over this page.
  // Other parameters on the patient page (such as ?tab=) are kept.
  const openHistory = useCallback(() => {
    if (style === "page") void navigate(to);
    else
      setSearch((prev) => {
        const next = new URLSearchParams(prev);
        next.set("history", "1");
        return next;
      });
  }, [style, navigate, to, setSearch]);
  const closeOverlay = () => {
    setSearch(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("history");
        next.delete("visit");
        return next;
      },
      { replace: true },
    );
  };
  // Back from the history, or closing the overlay, puts focus here again.
  const state: unknown = location.state;
  const returned = typeof state === "object" && state !== null && "focusHistory" in state && state.focusHistory === true;
  useEffect(() => {
    if (returned) ref.current?.focus();
  }, [returned]);
  const wasOpen = useRef(false);
  useEffect(() => {
    if (wasOpen.current && !overlayOpen) ref.current?.focus();
    wasOpen.current = overlayOpen;
  }, [overlayOpen]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "h" && e.key !== "H") return;
      if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing || e.defaultPrevented || typing(e.target)) return;
      if (document.querySelector(OPEN_DIALOG) !== null) return;
      e.preventDefault();
      openHistory();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
    };
  }, [openHistory]);
  return (
    <>
    {overlayOpen ? (
      <Suspense fallback={null}>
        <HistoryOverlay patientId={id} style={style === "story" ? "story" : "popup"} onClose={closeOverlay} />
      </Suspense>
    ) : null}
    <button ref={ref} type="button" className="p360-history" aria-keyshortcuts="H" onClick={openHistory}>
      <History aria-hidden="true" />
      History
      {count === undefined ? null : <span className="p360-history-n">{`${String(count)} visit${count === 1 ? "" : "s"}`}</span>}
      <kbd aria-hidden="true">H</kbd>
    </button>
    </>
  );
}

/** The allergies as one tag in the header, so nobody prescribes past them. The flags panel under More confirms or edits them. */
export function AllergyTag({ patientId: id }: { patientId: PatientId }) {
  const flags = useClinicalFlags(id).data;
  if (flags === undefined || flags.allergy_count === 0) return null;
  const active = flags.allergies.filter((a) => a.status === "active");
  const text =
    flags.details_hidden || active.length === 0
      ? `${String(flags.allergy_count)} recorded ${flags.allergy_count === 1 ? "allergy" : "allergies"}`
      : `Allergy: ${active.map((a) => a.substance).join(", ")}`;
  return (
    <span role="status" aria-label="Allergies">
      <Tag tone={flags.severe_allergy ? "down" : "wait"}>{text}</Tag>
    </span>
  );
}
