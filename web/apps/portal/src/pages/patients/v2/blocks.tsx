/**
 * The blocks of the new Patient 360. Each one composes what the portal already has (the chart and tooth panel, quick
 * picks, voice recorder, prescription editor, plans, consent, files, notes) and none re-implements it. The three
 * layouts arrange the same blocks, so they always show the same data.
 */
import { FileText, Mic, Pause, Play, Printer, Share2, Square } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router";

import { apiErrorOf, type Patient, type Visit } from "@aarogyam/api-client";
import { ApiErrorNotice, formatDate, formatDateTime, formatRupees } from "@aarogyam/app-kit";
import { Button, Field, Select, TextArea, TextInput, useToast } from "@sakalya/ui";

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
import { DICTATION_LANGUAGES, clock, type DictationLanguage } from "../../visits/voice/dictation.js";
import { ClinicalFlagsPanel } from "../clinical-flags-panel.js";
import { ConsentPanel } from "../consent-panel.js";
import { DentalChartPanel } from "../dental-chart-panel.js";
import { FilesPanel } from "../files-panel.js";
import { NotesPanel } from "../notes-panel.js";
import { PatientAppCard } from "../patient-app-card.js";
import { CarePlan, Contact, Kv } from "../patient-page.js";
import { BillsPanel } from "../records-panels.js";
import { FOLLOW_UPS } from "./finish-visit.js";
import { GalleryBlock } from "./images.js";
import { Bento, Chip, Fold } from "./kit.js";
import { VisitDetail } from "./visit-detail.js";
import { NOTE_SECTIONS, useVisitSession, type SectionKey } from "./visit-session.js";
import { Phone, Mail } from "lucide-react";

/** Shown in place of a block that needs an open visit. The one Start visit button is in the bar at the top. */
export function StartVisitPrompt({ what }: { what: string }) {
  const session = useVisitSession();
  if (session.visitLoading) {
    return <SkeletonRows count={1} label="Loading the visit" />;
  }
  return (
    <p className="mk-hint" style={{ margin: 0 }}>
      {session.canWrite ? `Start the visit above to ${what}.` : "There is no open visit."}
    </p>
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

const VOICE_LINE = /^\[(\d{2}:\d{2})\]\s*(.*)$/;

/** The note's lines split into voice notes (stamped with their start time, in the order recorded) and everything else. */
export function splitNote(values: Record<SectionKey, string>): { voice: { at: string; text: string }[]; other: { label: string; text: string }[] } {
  const voice: { at: string; text: string }[] = [];
  const other: { label: string; text: string }[] = [];
  for (const { key, label } of NOTE_SECTIONS) {
    const rest: string[] = [];
    for (const line of values[key].split("\n")) {
      const match = key === "subjective" ? VOICE_LINE.exec(line) : null;
      if (match?.[1] !== undefined) voice.push({ at: match[1], text: match[2] ?? "" });
      else if (line.trim() !== "") rest.push(line);
    }
    if (rest.length > 0) other.push({ label, text: rest.join(" · ") });
  }
  return { voice, other };
}

/** Today's notes: record voice notes (several per visit, each stamped with its start time) and see them together, in order. */
export function VoiceBlock() {
  const session = useVisitSession();
  const { visit, note, voice } = session;
  const parts = splitNote(note.values);
  const active = voice.phase === "recording" || voice.phase === "paused";
  return (
    <Bento title="Today's notes" sub="Record a voice note and it types for you. Add as many as you need.">
      {visit === undefined ? (
        <StartVisitPrompt what="take notes" />
      ) : !session.canWrite ? (
        <p className="mk-hint">You can read this visit's note but not change it.</p>
      ) : (
        <div className="flex flex-col gap-3">
          <section aria-label="Voice recorder" className="p360-voice">
            <div className="flex flex-wrap items-end gap-2">
              <Field label="Language" className="w-40">
                <Select
                  options={DICTATION_LANGUAGES.map((language) => ({ value: language.value, label: language.label }))}
                  value={voice.language}
                  disabled={voice.phase !== "idle"}
                  onValueChange={(next: DictationLanguage) => {
                    voice.setLanguage(next);
                  }}
                />
              </Field>
              {active ? (
                <>
                  {voice.phase === "recording" ? (
                    <Button variant="secondary" icon={<Pause aria-hidden="true" className="size-4" />} onClick={voice.pause}>
                      Pause
                    </Button>
                  ) : (
                    <Button variant="secondary" icon={<Play aria-hidden="true" className="size-4" />} onClick={voice.resume}>
                      Resume
                    </Button>
                  )}
                  <Button icon={<Square aria-hidden="true" className="size-4" />} disabled={voice.saving} onClick={voice.save}>
                    {voice.saving ? "Saving…" : "Save"}
                  </Button>
                </>
              ) : (
                <Button
                  icon={<Mic aria-hidden="true" className="size-4" />}
                  disabled={voice.phase === "starting" || voice.saving}
                  onClick={() => {
                    voice.start();
                  }}
                >
                  {voice.phase === "starting" ? "Opening the microphone…" : voice.saving ? "Saving…" : "Start speaking"}
                </Button>
              )}
            </div>
            {active || voice.saving ? (
              <p className="p360-voice-time" role="timer" aria-label="Recording time">
                {voice.phase === "paused" ? "Paused · " : "Recording · "}
                {clock(voice.seconds)}
              </p>
            ) : null}
            {active || voice.transcript !== "" ? (
              <p className="p360-transcript" aria-label="Live transcript" aria-live="polite">
                {voice.transcript}
                {voice.interim === "" ? null : <span className="p360-interim"> {voice.interim}</span>}
                {voice.transcript === "" && voice.interim === "" ? (
                  <span className="mk-hint" style={{ margin: 0 }}>
                    {voice.dictationSupported ? "Listening…" : "Live text isn't available in this browser. The audio is still kept; type the note yourself, or use Chrome or Edge."}
                  </span>
                ) : null}
              </p>
            ) : null}
            {voice.error === undefined ? null : (
              <p role="alert" className="mk-hint" style={{ color: "var(--red)", margin: 0 }}>
                {voice.error}
              </p>
            )}
          </section>
          {parts.voice.length === 0 && parts.other.length === 0 ? (
            <p className="mk-hint" style={{ margin: 0 }}>
              Nothing in today's note yet.
            </p>
          ) : (
            <div aria-label="In today's note" role="group" className="flex flex-col gap-2">
              {parts.voice.length === 0 ? null : (
                <ol aria-label="Voice notes" className="p360-voice-list">
                  {parts.voice.map((line, index) => (
                    <li key={`${line.at}-${String(index)}`}>
                      <time className="mk-mono">{line.at}</time>
                      <span>{line.text}</span>
                    </li>
                  ))}
                </ol>
              )}
              {parts.other.map(({ label, text }) => (
                <p key={label} className="m-0 text-sm">
                  <span className="mk-hint" style={{ margin: 0 }}>
                    {label}:{" "}
                  </span>
                  {text}
                </p>
              ))}
            </div>
          )}
          <Fold title="Edit the note">
            <NoteEditor />
          </Fold>
        </div>
      )}
    </Bento>
  );
}

/** The four sections of the draft note, to fix a word. Voice notes and quick picks land here as lines. */
function NoteEditor() {
  const session = useVisitSession();
  const { note } = session;
  const toast = useToast();
  if (!note.hasDraft) {
    return (
      <div className="flex flex-col items-start gap-2">
        <p className="mk-hint" style={{ margin: 0 }}>
          No draft note yet for this visit.
        </p>
        <Button disabled={note.starting} onClick={note.start}>
          {note.starting ? "Starting…" : "Start a note"}
        </Button>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="p360-note">
        {NOTE_SECTIONS.map(({ key, label }) => (
          <Field key={key} label={label}>
            <TextArea
              rows={4}
              value={note.values[key]}
              onChange={(event) => {
                note.set(key, event.target.value);
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
  const { can } = useClinic();
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
      {can("billing.write") ? (
        <Field label="Fee (₹)" hint="Starts the bill when the visit ends. Leave blank to bill later." className="mt-3">
          <TextInput
            inputMode="decimal"
            value={session.fee}
            onChange={(event) => {
              session.setFee(event.currentTarget.value);
            }}
          />
        </Field>
      ) : null}
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
  const [detail, setDetail] = useState<Visit | undefined>(undefined);
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
                <button
                  type="button"
                  className="mk-link p360-visitlink"
                  aria-label={`Open visit ${visit.number}`}
                  onClick={() => {
                    setDetail(visit);
                  }}
                >
                  <b>{visit.number}</b>
                </button>
                <Tag tone={statusTone(visit.status === "open" ? "warning" : "success")}>{visit.status === "open" ? "Open" : "Closed"}</Tag>
                <span className="mk-hint" style={{ margin: 0 }}>
                  {visit.clinician.name}
                </span>
                <span className="when">{formatDateTime(visit.started_at)}</span>
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
      {detail === undefined ? null : (
        <VisitDetail
          patientId={session.patientId}
          visit={detail}
          onClose={() => {
            setDetail(undefined);
          }}
        />
      )}
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

/** X-rays and photos: add one with a tag, and see them all. */
export function ImagesBlock({ patientId }: { patientId: Patient["id"] }) {
  const session = useVisitSession();
  const { can } = useClinic();
  return (
    <Bento title="X-rays and photos">
      <GalleryBlock patientId={patientId} canUpload={can("clinical.write")} visitId={session.visit?.id} />
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
