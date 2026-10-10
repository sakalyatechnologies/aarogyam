/**
 * The blocks of the new Patient 360. Each one composes what the portal already has (the chart and tooth panel, quick
 * picks, voice recorder, prescription editor, plans, consent, files, notes) and none re-implements it. The three
 * layouts arrange the same blocks, so they always show the same data.
 */
import { FileText, Mic, Printer, Share2, Stethoscope } from "lucide-react";
import { useRef, useState } from "react";
import { Link, useNavigate } from "react-router";

import { apiErrorOf, type Patient } from "@aarogyam/api-client";
import { ApiErrorNotice, formatDate, formatDateTime, formatRupees } from "@aarogyam/app-kit";
import { Button, Field, TextArea, useToast } from "@sakalya/ui";

import { Empty, Tag, Timeline, statusTone } from "../../../components/mk/index.js";
import { SkeletonRows } from "../../../components/skeleton-rows.js";
import { useClinic } from "../../../clinic.js";
import { languageLabel, formatPhone, maskEmail, maskPhone } from "../../../lib/patients.js";
import { useTimeline, useVisits } from "../../../queries.js";
import { DraftEditor, SentNotice, ShareDialog } from "../../prescriptions/prescription-page.js";
import { MedicineSets } from "../../prescriptions/medicine-sets.js";
import { usePrescriptions } from "../../prescriptions/queries.js";
import { TreatmentPlansCard } from "../../treatment-plans/treatment-plans-card.js";
import { ProceduresCard } from "../../visits/visit-page.js";
import { QuickPickBar } from "../../visits/quick-pick-bar.js";
import { useUploadRecording } from "../../visits/queries.js";
import { insertAt } from "../../visits/voice/dictation.js";
import { VoiceRecorder } from "../../visits/voice/voice-recorder.js";
import { ClinicalFlagsPanel } from "../clinical-flags-panel.js";
import { ConsentPanel } from "../consent-panel.js";
import { DentalChartPanel } from "../dental-chart-panel.js";
import { FilesPanel } from "../files-panel.js";
import { NotesPanel } from "../notes-panel.js";
import { PatientAppCard } from "../patient-app-card.js";
import { CarePlan, Contact, Kv } from "../patient-page.js";
import { BillsPanel } from "../records-panels.js";
import { FOLLOW_UPS } from "./finish-visit.js";
import { Bento, Chip } from "./kit.js";
import { NOTE_SECTIONS, useVisitSession, type SectionKey } from "./visit-session.js";
import { Phone, Mail } from "lucide-react";

/** Shown in place of a block that needs an open visit. */
export function StartVisitPrompt({ what }: { what: string }) {
  const session = useVisitSession();
  if (session.visitLoading) {
    return <SkeletonRows count={1} label="Loading the visit" />;
  }
  return (
    <div className="flex flex-col items-start gap-2">
      <p className="mk-hint" style={{ margin: 0 }}>
        {session.canWrite ? `Start a visit to ${what}.` : "There is no open visit."}
      </p>
      {session.canWrite ? (
        <Button icon={<Stethoscope aria-hidden="true" className="size-4" />} disabled={session.starting} onClick={session.startVisit}>
          {session.starting ? "Starting…" : "Start visit"}
        </Button>
      ) : null}
    </div>
  );
}

/** The odontogram with its tooth panel and record dialog. Append-only: a correction is a new entry that supersedes the old one. */
export function ToothBlock({ patientId }: { patientId: Patient["id"] }) {
  return (
    <div className="p360-bento">
      <DentalChartPanel patientId={patientId} />
    </div>
  );
}

/** Quick picks that add one-line complaints, findings and advice to the visit note. */
export function SaysBlock() {
  const session = useVisitSession();
  const preview = NOTE_SECTIONS.filter(({ key }) => session.note.values[key].trim() !== "");
  return (
    <Bento title="What the patient says" sub="Tap to add a line to today's note">
      {session.visit === undefined ? (
        <StartVisitPrompt what="take notes" />
      ) : !session.canWrite ? (
        <p className="mk-hint">You can read this visit's note but not change it.</p>
      ) : (
        <>
          <QuickPickBar patientId={session.patientId} visitId={session.visit.id} onPick={session.note.pick} />
          {session.error === undefined ? null : (
            <p role="alert" className="mk-hint" style={{ color: "var(--red)" }}>
              {session.error}
            </p>
          )}
          {preview.length === 0 ? null : (
            <div aria-label="In today's note" role="group">
              <p className="p360-label">In today's note</p>
              <ul className="m-0 flex list-none flex-col gap-1 p-0 text-sm">
                {preview.map(({ key, label }) => (
                  <li key={key}>
                    <span className="mk-hint" style={{ margin: 0 }}>
                      {label}:{" "}
                    </span>
                    {session.note.values[key].split("\n").join(" · ")}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </Bento>
  );
}

/** Procedures done in this visit: record one, mark a planned one done. */
export function DoneTodayBlock() {
  const session = useVisitSession();
  if (session.visit === undefined || session.visitLoading) return null;
  return (
    <div className="p360-bento" aria-label="Done today">
      <ProceduresCard visitId={session.visit.id} patientId={session.patientId} procedures={session.procedures} canWrite={session.canWrite} />
    </div>
  );
}

/** The doctor's note for the visit: the four sections, typed or dictated (English, Hindi, Marathi or Gujarati). */
export function VoiceBlock() {
  const session = useVisitSession();
  const { visit, note } = session;
  return (
    <Bento title="Voice notes" sub="Speak while you work and it types for you. Edit anything.">
      {visit === undefined ? (
        <StartVisitPrompt what="dictate a note" />
      ) : !session.canWrite ? (
        <p className="mk-hint">You can read this visit's note but not change it.</p>
      ) : !note.hasDraft ? (
        <div className="flex flex-col items-start gap-2">
          <p className="mk-hint" style={{ margin: 0 }}>
            No draft note yet for this visit.
          </p>
          <Button disabled={note.starting} onClick={note.start}>
            {note.starting ? "Starting…" : "Start a note"}
          </Button>
        </div>
      ) : (
        <VoiceNoteEditor visitId={visit.id} />
      )}
    </Bento>
  );
}

function VoiceNoteEditor({ visitId }: { visitId: NonNullable<ReturnType<typeof useVisitSession>["visit"]>["id"] }) {
  const session = useVisitSession();
  const { note } = session;
  const upload = useUploadRecording(session.patientId, visitId);
  const toast = useToast();
  const focused = useRef<SectionKey>("subjective");
  const selection = useRef<Partial<Record<SectionKey, { start: number; end: number }>>>({});
  const remember = (key: SectionKey, box: HTMLTextAreaElement) => {
    focused.current = key;
    selection.current[key] = { start: box.selectionStart, end: box.selectionEnd };
  };
  const insert = (text: string) => {
    const key = focused.current;
    const current = note.values[key];
    const at = selection.current[key] ?? { start: current.length, end: current.length };
    const next = insertAt(current, at.start, at.end, text);
    selection.current[key] = { start: next.cursor, end: next.cursor };
    note.set(key, next.value);
  };
  const keep = async (finished: Parameters<React.ComponentProps<typeof VoiceRecorder>["onKeep"]>[0]) => {
    if (note.noteId === undefined) return;
    try {
      // The dictated text is saved first, so a failed upload never loses it.
      await note.save();
      await upload.mutateAsync({ recording: finished, target: { noteId: note.noteId, visitId } });
    } catch (thrown) {
      throw new Error(apiErrorOf(thrown)?.message ?? "Couldn't save the recording. Please try again.", { cause: thrown });
    }
    toast.show({ title: "Recording kept with the note", tone: "success" });
    session.setVoiceOpen(false);
  };
  return (
    <div className="flex flex-col gap-3">
      {session.voiceOpen ? (
        <VoiceRecorder
          onInsert={insert}
          onKeep={keep}
          onClose={() => {
            session.setVoiceOpen(false);
          }}
        />
      ) : (
        <div>
          <Button
            variant="secondary"
            icon={<Mic aria-hidden="true" className="size-4" />}
            onClick={() => {
              session.setVoiceOpen(true);
            }}
          >
            Record voice
          </Button>
        </div>
      )}
      <div className="p360-note">
        {NOTE_SECTIONS.map(({ key, label }) => (
          <Field key={key} label={label}>
            <TextArea
              rows={4}
              value={note.values[key]}
              onChange={(event) => {
                note.set(key, event.target.value);
                remember(key, event.target);
              }}
              onFocus={(event) => {
                remember(key, event.target);
              }}
              onSelect={(event) => {
                remember(key, event.currentTarget);
              }}
              onBlur={(event) => {
                remember(key, event.target);
              }}
            />
          </Field>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="mk-hint" style={{ margin: 0 }} aria-live="polite">
          {note.saving ? "Saving…" : note.dirty ? "Not saved yet" : "Draft in step with the server"}
        </span>
        <Button
          variant="secondary"
          disabled={!note.dirty || note.saving}
          onClick={() => {
            note.save().then(
              () => {
                toast.show({ title: "Draft saved", tone: "success" });
              },
              (thrown: unknown) => {
                toast.show({ title: apiErrorOf(thrown)?.message ?? "Couldn't save the draft.", tone: "danger" });
              },
            );
          }}
        >
          Save draft
        </Button>
      </div>
    </div>
  );
}

/** The prescription for this visit: medicine sets, search, the server's allergy check with an override reason, and the patient's link. */
export function RxBlock() {
  const session = useVisitSession();
  const { rx } = session;
  const navigate = useNavigate();
  const [sharing, setSharing] = useState(false);
  if (!session.canRx) return null;
  return (
    <Bento title="Prescription" sub="Sets, search, or type any medicine. Every field is editable.">
      {rx.issued !== undefined && rx.draft === undefined ? (
        <div className="flex flex-col gap-3">
          <SentNotice message={rx.issued.message} />
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              icon={<Printer aria-hidden="true" className="size-4" />}
              onClick={() => {
                void navigate(`/prescriptions/${rx.issued?.rx.id ?? ""}/print`, { state: { pin: rx.issued?.message.pin ?? null } });
              }}
            >
              Print
            </Button>
            <Button
              variant="secondary"
              icon={<Share2 aria-hidden="true" className="size-4" />}
              onClick={() => {
                setSharing(true);
              }}
            >
              Share with patient
            </Button>
            <Button variant="secondary" onClick={rx.dismissIssued}>
              Start another
            </Button>
          </div>
          <ShareDialog
            open={sharing}
            rxId={rx.issued.rx.id}
            onClose={() => {
              setSharing(false);
            }}
          />
        </div>
      ) : rx.draft === undefined ? (
        <div className="flex flex-col gap-3">
          <MedicineSets
            onAdd={(items) => {
              void rx.addItems(items);
            }}
          />
          <div className="flex flex-wrap gap-2">
            <Button icon={<FileText aria-hidden="true" className="size-4" />} disabled={rx.busy} onClick={rx.start}>
              New prescription
            </Button>
            {rx.quick === undefined ? null : (
              <Button variant="secondary" disabled={rx.busy} onClick={rx.quick}>
                Quick Rx
              </Button>
            )}
          </div>
          {session.error === undefined ? null : (
            <p role="alert" className="mk-hint" style={{ color: "var(--red)" }}>
              {session.error}
            </p>
          )}
        </div>
      ) : (
        <DraftEditor
          key={`${rx.draft.id}:${String(rx.version)}`}
          rx={rx.draft}
          handle={rx.handle}
          onIssued={(message) => {
            if (rx.draft !== undefined) rx.noteIssued(rx.draft, message);
          }}
        />
      )}
    </Bento>
  );
}

/** Follow-up and what the patient link will do. */
export function WrapBlock() {
  const session = useVisitSession();
  return (
    <Bento title="Wrap up">
      <p className="p360-label">Follow-up</p>
      <div className="p360-chips" role="group" aria-label="Follow-up">
        {FOLLOW_UPS.map((option) => (
          <Chip
            key={option.label}
            pressed={session.follow?.label === option.label}
            disabled={!session.canWrite}
            onClick={() => {
              session.setFollow(session.follow?.label === option.label ? null : option);
            }}
          >
            {option.label}
          </Chip>
        ))}
      </div>
      {session.canRx ? (
        <p className="p360-pill-note">
          The prescription link works for 7 days and needs a PIN, which is shown once. You create it after you issue the prescription.
        </p>
      ) : null}
    </Bento>
  );
}

/** Every visit, and the patient's timeline. */
export function HistoryBlock({ limit = 8 }: { limit?: number }) {
  const session = useVisitSession();
  const visits = useVisits(session.patientId);
  const timeline = useTimeline(session.patientId);
  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="p360-label">Visits</p>
        {visits.isPending ? (
          <SkeletonRows count={2} label="Loading visits" />
        ) : visits.isError ? (
          <ApiErrorNotice title="Couldn't load visits" error={visits.error} onRetry={() => void visits.refetch()} />
        ) : visits.data.items.length === 0 ? (
          <Empty art="notes" title="No visits yet">
            Visits appear here as they are recorded.
          </Empty>
        ) : (
          <ul aria-label="Visits" className="m-0 list-none p-0">
            {visits.data.items.map((visit) => (
              <li key={visit.id} className="p360-histrow">
                <b>{visit.number}</b>
                <Tag tone={statusTone(visit.status === "open" ? "warning" : "success")}>{visit.status === "open" ? "Open" : "Closed"}</Tag>
                <span className="mk-hint" style={{ margin: 0 }}>
                  {visit.clinician.name}
                </span>
                <span className="when">{formatDateTime(visit.started_at)}</span>
                <Link className="mk-link" to={`/patients/${session.patientId}/visits/${visit.id}`}>
                  Open
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <p className="p360-label">Timeline</p>
        {timeline.isPending ? (
          <SkeletonRows count={3} label="Loading history" />
        ) : timeline.isError || timeline.data.items.length === 0 ? (
          <Empty art="notes" title="No history yet">
            Visits, notes, procedures and files appear here as they are recorded.
          </Empty>
        ) : (
          <Timeline
            label="Clinical history"
            items={timeline.data.items.slice(0, limit).map((event) => ({
              id: event.id,
              when: formatDate(event.at),
              title: event.title,
              detail: [event.detail, event.by?.name].filter((part) => part != null && part !== "").join(" · ") || undefined,
            }))}
          />
        )}
      </div>
    </div>
  );
}

/** Earlier prescriptions, with the allergy override each was issued under. */
export function PastRxBlock() {
  const session = useVisitSession();
  const prescriptions = usePrescriptions(session.patientId);
  if (prescriptions.isPending) return <SkeletonRows count={2} label="Loading prescriptions" />;
  if (prescriptions.isError) {
    return <ApiErrorNotice title="Couldn't load prescriptions" error={prescriptions.error} onRetry={() => void prescriptions.refetch()} />;
  }
  const items = [...prescriptions.data.items].sort((a, b) => (b.issued_at ?? b.created_at).localeCompare(a.issued_at ?? a.created_at));
  if (items.length === 0) {
    return (
      <Empty art="rx" title="No prescriptions yet">
        Drafts and issued prescriptions will appear here.
      </Empty>
    );
  }
  return (
    <ul aria-label="Past prescriptions" className="m-0 flex list-none flex-col gap-2 p-0">
      {items.map((item) => (
        <li key={item.id} className="p360-histrow" style={{ display: "block" }}>
          <div className="flex flex-wrap items-center gap-2">
            <Link className="mk-link mk-mono" to={`/prescriptions/${item.id}`}>
              {item.number ?? "Draft"}
            </Link>
            <Tag tone={statusTone(item.status === "issued" ? "success" : item.status === "cancelled" ? "danger" : "neutral")}>{item.status}</Tag>
            {item.alerts.length === 0 ? null : <Tag tone="wait">Allergy override</Tag>}
            <span className="when" style={{ marginLeft: "auto" }}>
              {formatDate(item.issued_at ?? item.created_at)}
            </span>
          </div>
          <p className="mk-hint" style={{ margin: "6px 0 0" }}>
            {item.items.map((line) => `${line.drug_name ?? ""} ${line.strength ?? ""}`.trim()).join(" · ") || "No medicines"}
          </p>
        </li>
      ))}
    </ul>
  );
}

export function ConsentBlock({ patientId }: { patientId: Patient["id"] }) {
  return (
    <div className="p360-bento">
      <ConsentPanel patientId={patientId} />
    </div>
  );
}

/** The treatment plan: editable inside an open visit, read-only progress otherwise. */
export function PlanBlock() {
  const session = useVisitSession();
  return (
    <div className="p360-bento">
      {session.visit === undefined ? (
        <CarePlan patientId={session.patientId} />
      ) : (
        <TreatmentPlansCard patientId={session.patientId} visitId={session.visit.id} canWrite={session.canWrite} />
      )}
    </div>
  );
}

export function FlagsBlock({ patientId }: { patientId: Patient["id"] }) {
  return (
    <Bento title="Clinical flags">
      <ClinicalFlagsPanel patientId={patientId} />
    </Bento>
  );
}

export function FilesBlock({ patientId }: { patientId: Patient["id"] }) {
  return (
    <Bento title="Files">
      <FilesPanel patientId={patientId} />
    </Bento>
  );
}

export function NotesBlock({ patientId }: { patientId: Patient["id"] }) {
  return (
    <Bento title="Notes">
      <NotesPanel patientId={patientId} />
    </Bento>
  );
}

export function BillingBlock({ patientId }: { patientId: Patient["id"] }) {
  const { can } = useClinic();
  if (!can("billing.read")) return null;
  return (
    <Bento title="Billing">
      <BillsPanel patientId={patientId} />
    </Bento>
  );
}

/** Who the patient is: dates, language, contact (masked unless the role may see it), and the patient app. Money only with billing.read. */
export function DetailsBlock({ patient }: { patient: Patient }) {
  const { can } = useClinic();
  const age = patient.age_years ?? null;
  const revealable = can("patients.contact");
  return (
    <Bento title="Details">
      <dl className="p360-dl">
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
        {patient.email == null ? null : <Contact icon={<Mail size={15} />} label="Email" value={patient.email} masked={maskEmail(patient.email)} revealable={revealable} />}
      </div>
      <div style={{ marginTop: 12 }}>
        <PatientAppCard patientId={patient.id} />
      </div>
    </Bento>
  );
}
