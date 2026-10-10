import { Check, Lock, MessageSquarePlus, Mic, Plus } from "lucide-react";
import { useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";

import {
  apiErrorOf,
  patientId as parsePatientId,
  visitId as parseVisitId,
  type Attachment,
  type Note,
  type NoteId,
  type Observation,
  type ObservationKind,
  type PatientId,
  type Procedure,
  type VisitId,
} from "@aarogyam/api-client";
import { ApiErrorNotice, Markdown, formatDateTime, useDocumentTitle } from "@aarogyam/app-kit";
import { Button, Dialog, Field, Select, TextArea, TextInput, useToast } from "@sakalya/ui";
import { MkCard, Tag, statusTone, Empty, PageHeader } from "../../components/mk/index.js";

import { useClinic } from "../../clinic.js";
import { patientPath } from "../../lib/patients.js";
import {
  useCloseVisit,
  useCompleteProcedure,
  useCreateNote,
  useRecordObservations,
  useRecordProcedure,
  useSignNote,
  useVisit,
} from "../../queries.js";
import { NotFoundPage } from "../not-found-page.js";
import { TreatmentPlansCard } from "../treatment-plans/treatment-plans-card.js";
import { DraftNoteEditor, type DraftHandle } from "./draft-note-editor.js";
import { useAddAddendum, useUploadRecording } from "./queries.js";
import { RecordingPlayer } from "./voice/recording-player.js";
import type { FinishedRecording } from "./voice/use-voice-recorder.js";
import { VoiceRecorder } from "./voice/voice-recorder.js";
import { insertAt } from "./voice/dictation.js";
import { SkeletonRows } from "../../components/skeleton-rows.js";

const OBSERVATION_KINDS: readonly { value: ObservationKind; label: string; unit: string }[] = [
  { value: "bp_systolic", label: "BP systolic", unit: "mmHg" },
  { value: "bp_diastolic", label: "BP diastolic", unit: "mmHg" },
  { value: "pulse", label: "Pulse", unit: "/min" },
  { value: "temperature", label: "Temperature", unit: "Cel" },
  { value: "spo2", label: "SpO2", unit: "%" },
  { value: "weight", label: "Weight", unit: "kg" },
  { value: "height", label: "Height", unit: "cm" },
  { value: "blood_sugar", label: "Blood sugar", unit: "mg/dL" },
];

function parseIds(patientParam: string | undefined, visitParam: string | undefined): { patientId: PatientId; visitId: VisitId } | undefined {
  const patient = parsePatientId.safeParse(patientParam);
  const visit = parseVisitId.safeParse(visitParam);
  return patient.success && visit.success ? { patientId: patient.data, visitId: visit.data } : undefined;
}

/** A visit: notes, vitals and procedures recorded against it, closed when the patient leaves. */
export function VisitPage() {
  const params = useParams();
  const ids = parseIds(params["id"], params["visitId"]);
  const visit = useVisit(ids?.visitId);
  const { session } = useClinic();
  useDocumentTitle(visit.data?.visit.number, "Patients", session.clinic.name);
  if (ids === undefined) {
    return <NotFoundPage title="We couldn't find that visit" />;
  }
  if (visit.isPending) {
    return <SkeletonRows count={4} tall label="Loading the visit" />;
  }
  if (visit.isError) {
    return <ApiErrorNotice title="Couldn't open this visit" error={visit.error} onRetry={() => void visit.refetch()} />;
  }
  return <VisitView patientId={ids.patientId} detail={visit.data} />;
}

function VisitView({ patientId, detail }: { patientId: PatientId; detail: NonNullable<ReturnType<typeof useVisit>["data"]> }) {
  const { can } = useClinic();
  const { visit } = detail;
  const canWrite = can("clinical.write");
  const close = useCloseVisit(patientId, visit.id);
  const toast = useToast();
  const isOpen = visit.status === "open";
  const navigate = useNavigate();
  const closeVisit = (then?: () => void) => {
    close.mutate(undefined, {
      onSuccess: () => {
        toast.show({ title: "Visit closed", tone: "success" });
        then?.();
      },
      onError: (thrown) => {
        toast.show({ title: apiErrorOf(thrown)?.message ?? "Couldn't close that visit.", tone: "danger" });
      },
    });
  };

  return (
    <>
      <PageHeader
        title={`Visit ${visit.number}`}
        subtitle={`${formatDateTime(visit.started_at)} · ${visit.clinician.name}`}
        end={
          <div className="flex items-center gap-2">
            <Tag tone={statusTone(isOpen ? "warning" : "success")}>{isOpen ? "Open" : "Closed"}</Tag>
            {canWrite && isOpen ? (
              <Button
                variant="secondary"
                disabled={close.isPending}
                onClick={() => {
                  closeVisit();
                }}
              >
                {close.isPending ? "Closing…" : "Close visit"}
              </Button>
            ) : null}
            {canWrite && isOpen && can("billing.write") ? (
              <Button
                disabled={close.isPending}
                onClick={() => {
                  closeVisit(() => {
                    void navigate(`/billing/invoices/new?patient=${encodeURIComponent(patientId)}`);
                  });
                }}
              >
                Complete and bill
              </Button>
            ) : null}
          </div>
        }
      />
      <div className="mb-4">
        <a href={patientPath({ id: patientId })} className="text-sm font-semibold text-primary-text hover:underline">
          Back to patient
        </a>
      </div>
      {visit.chief_complaint == null ? null : (
        <p className="mb-4 text-sm text-muted">
          <span className="font-semibold text-text">Chief complaint:</span> {visit.chief_complaint}
        </p>
      )}
      <div className="flex flex-col gap-4">
        <NotesCard
          patientId={patientId}
          visitId={visit.id}
          notes={detail.notes}
          recordings={detail.attachments.filter((file) => file.kind === "audio")}
          canWrite={canWrite && isOpen}
          canAddend={canWrite}
        />
        <VitalsCard visitId={visit.id} observations={detail.observations} canWrite={canWrite && isOpen} />
        <ProceduresCard visitId={visit.id} patientId={patientId} procedures={detail.procedures} canWrite={canWrite && isOpen} />
        {can("clinical.read") ? <TreatmentPlansCard patientId={patientId} visitId={visit.id} canWrite={canWrite} /> : null}
        {detail.chart_entries.length === 0 ? null : (
          <MkCard title="Dental chart entries in this visit">
            <ul className="flex flex-col gap-1.5 text-sm">
              {detail.chart_entries.map((entry) => (
                <li key={entry.id}>
                  Tooth {entry.tooth}
                  {entry.surface == null ? "" : ` (${entry.surface})`}: <span className="font-semibold text-text">{entry.finding}</span>
                  {[entry.procedure?.label, entry.material?.label].some((part) => part !== undefined)
                    ? ` · ${[entry.procedure?.label, entry.material?.label].filter((part) => part !== undefined).join(" · ")}`
                    : null}
                </li>
              ))}
            </ul>
          </MkCard>
        )}
      </div>
    </>
  );
}

function NotesCard({
  patientId,
  visitId,
  notes,
  recordings,
  canWrite,
  canAddend,
}: {
  patientId: PatientId;
  visitId: VisitId;
  notes: readonly Note[];
  recordings: readonly Attachment[];
  canWrite: boolean;
  canAddend: boolean;
}) {
  const createNote = useCreateNote(visitId);
  const [drafting, setDrafting] = useState(false);
  const toast = useToast();
  return (
    <MkCard
      title="Notes"
      action={
        canWrite ? (
          <Button
            variant="secondary"
            icon={<Plus aria-hidden="true" className="size-4" />}
            disabled={createNote.isPending || drafting}
            onClick={() => {
              setDrafting(true);
              createNote.mutate(
                { kind: "soap" },
                {
                  onError: (thrown) => {
                    setDrafting(false);
                    toast.show({ title: apiErrorOf(thrown)?.message ?? "Couldn't start a note.", tone: "danger" });
                  },
                  onSettled: () => {
                    setDrafting(false);
                  },
                },
              );
            }}
          >
            New note
          </Button>
        ) : undefined
      }
    >
      {notes.length === 0 ? (
        <Empty title="No notes yet" />
      ) : (
        <div className="flex flex-col gap-4">
          {notes.map((note) => (
            <NoteCard
              key={note.id}
              patientId={patientId}
              visitId={visitId}
              note={note}
              recordings={recordings.filter((file) => file.note_id === note.id)}
              canEdit={canWrite}
              canAddend={canAddend}
            />
          ))}
        </div>
      )}
    </MkCard>
  );
}

function NoteCard({
  patientId,
  visitId,
  note,
  recordings,
  canEdit,
  canAddend,
}: {
  patientId: PatientId;
  visitId: VisitId;
  note: Note;
  recordings: readonly Attachment[];
  canEdit: boolean;
  canAddend: boolean;
}) {
  const sign = useSignNote(visitId);
  const { session } = useClinic();
  const [addending, setAddending] = useState(false);
  const toast = useToast();
  const sections = note.sections;
  const isDraft = note.status === "draft";
  const editing = isDraft && canEdit && note.author.id === session.membership.id;
  const draft = useRef<DraftHandle>(null);
  const noteRecordings = recordings.filter((file) => file.addendum_id == null);

  const onSign = (id: NoteId) => {
    // Typed or dictated text still on screen is saved first, so the signed note is what the doctor sees.
    (draft.current?.save() ?? Promise.resolve()).then(
      () => {
        sign.mutate(id, {
          onSuccess: () => {
            toast.show({ title: "Note signed", tone: "success" });
          },
          onError: (thrown) => {
            toast.show({ title: apiErrorOf(thrown)?.message ?? "Couldn't sign that note.", tone: "danger" });
          },
        });
      },
      (thrown: unknown) => {
        toast.show({ title: apiErrorOf(thrown)?.message ?? "Couldn't save the draft before signing.", tone: "danger" });
      },
    );
  };

  return (
    <div className="rounded-2xl border border-border p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-sm font-bold text-text">{note.kind.toUpperCase()}</p>
        <Tag tone={statusTone(note.status === "signed" ? "success" : note.status === "draft" ? "neutral" : "danger")}>{note.status}</Tag>
      </div>
      {editing ? (
        <DraftNoteEditor patientId={patientId} visitId={visitId} note={note} handle={draft} />
      ) : (
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <NoteSection label="Subjective" value={sections.subjective} />
          <NoteSection label="Objective" value={sections.objective} />
          <NoteSection label="Assessment" value={sections.assessment} />
          <NoteSection label="Plan" value={sections.plan} />
        </dl>
      )}
      {noteRecordings.length === 0 ? null : (
        <div className="mt-3 border-t border-border pt-3">
          <h4 className="text-xs font-semibold text-muted">Recordings</h4>
          <ul aria-label="Recordings" className="mt-1 flex flex-col gap-2">
            {noteRecordings.map((file) => (
              <RecordingPlayer key={file.id} recording={file} />
            ))}
          </ul>
        </div>
      )}
      {note.addenda.length === 0 ? null : (
        <div className="mt-3 border-t border-border pt-3">
          <h4 className="text-xs font-semibold text-muted">Addenda</h4>
          <ul aria-label="Addenda" className="mt-1 flex flex-col gap-2">
            {note.addenda.map((a) => (
              <li key={a.id} className="text-sm">
                <Markdown text={a.body} />
                <p className="text-xs text-muted">
                  {a.author.name} · {formatDateTime(a.created_at)}
                </p>
                <ul aria-label="Addendum recordings" className="mt-1 flex flex-col gap-2">
                  {recordings
                    .filter((file) => file.addendum_id === a.id)
                    .map((file) => (
                      <RecordingPlayer key={file.id} recording={file} />
                    ))}
                </ul>
              </li>
            ))}
          </ul>
        </div>
      )}
      {note.status === "signed" && canAddend ? (
        <div className="mt-3 flex justify-end">
          <Button
            variant="secondary"
            icon={<MessageSquarePlus aria-hidden="true" className="size-4" />}
            onClick={() => {
              setAddending(true);
            }}
          >
            Add addendum
          </Button>
        </div>
      ) : null}
      {addending ? (
        <AddendumDialog
          patientId={patientId}
          visitId={visitId}
          noteId={note.id}
          onOpenChange={() => {
            setAddending(false);
          }}
        />
      ) : null}
      {isDraft ? (
        <div className="mt-3 flex justify-end">
          <Button
            variant="secondary"
            icon={<Lock aria-hidden="true" className="size-4" />}
            disabled={sign.isPending}
            onClick={() => {
              onSign(note.id);
            }}
          >
            {sign.isPending ? "Signing…" : "Sign"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function AddendumDialog({
  patientId,
  visitId,
  noteId,
  onOpenChange,
}: {
  patientId: PatientId;
  visitId: VisitId;
  noteId: NoteId;
  onOpenChange: () => void;
}) {
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);
  const [recording, setRecording] = useState(false);
  const [pending, setPending] = useState<FinishedRecording | undefined>(undefined);
  const add = useAddAddendum(visitId);
  const upload = useUploadRecording(patientId, visitId);
  const toast = useToast();
  const box = useRef<HTMLTextAreaElement | null>(null);
  const latest = useRef("");
  const cursor = useRef<{ start: number; end: number } | undefined>(undefined);

  const change = (value: string) => {
    latest.current = value;
    setBody(value);
  };
  const remember = () => {
    if (box.current !== null) {
      cursor.current = { start: box.current.selectionStart, end: box.current.selectionEnd };
    }
  };
  const insert = (text: string) => {
    const at = cursor.current ?? { start: latest.current.length, end: latest.current.length };
    const next = insertAt(latest.current, at.start, at.end, text);
    cursor.current = { start: next.cursor, end: next.cursor };
    change(next.value);
  };

  const submit = () => {
    setError(undefined);
    add.mutate(
      { id: noteId, body: body.trim() },
      {
        onSuccess: (updated) => {
          // A recording joins a signed note only through its addendum: the one just written is the newest.
          const addendum = updated.addenda[updated.addenda.length - 1];
          if (pending === undefined || addendum === undefined) {
            toast.show({ title: "Addendum added", tone: "success" });
            onOpenChange();
            return;
          }
          upload.mutate(
            { recording: pending, target: { noteId, visitId, addendumId: addendum.id } },
            {
              onSuccess: () => {
                toast.show({ title: "Addendum and recording added", tone: "success" });
                onOpenChange();
              },
              onError: (thrown) => {
                toast.show({
                  title: `Addendum added, but the recording wasn't saved: ${apiErrorOf(thrown)?.message ?? "please try again from the visit."}`,
                  tone: "danger",
                });
                onOpenChange();
              },
            },
          );
        },
        onError: (thrown) => {
          setError(apiErrorOf(thrown)?.message ?? "Couldn't add that addendum. Please try again.");
        },
      },
    );
  };

  const busy = add.isPending || upload.isPending;
  return (
    <Dialog
      open
      onOpenChange={onOpenChange}
      title="Add an addendum"
      footer={
        <>
          <Button variant="secondary" onClick={onOpenChange}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={body.trim() === "" || busy}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Addendum" required hint="A signed note never changes; this is added beneath it.">
          <TextArea
            ref={box}
            value={body}
            onChange={(event) => {
              change(event.target.value);
              remember();
            }}
            onSelect={remember}
            onBlur={remember}
          />
        </Field>
        {pending === undefined ? null : <p className="text-sm text-muted">A {pending.seconds}-second recording will be saved with this addendum.</p>}
        {recording ? (
          <VoiceRecorder
            onInsert={insert}
            onKeep={(finished) => {
              setPending(finished);
              setRecording(false);
              return Promise.resolve();
            }}
            onClose={() => {
              setRecording(false);
            }}
          />
        ) : (
          <div>
            <Button
              variant="secondary"
              icon={<Mic aria-hidden="true" className="size-4" />}
              onClick={() => {
                setRecording(true);
              }}
            >
              Record voice
            </Button>
          </div>
        )}
        {error === undefined ? null : (
          <p role="alert" className="text-sm font-medium text-danger-text">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}

function NoteSection({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <dt className="text-xs font-semibold text-muted">{label}</dt>
      <dd className="text-text">{value == null || value === "" ? "—" : <Markdown text={value} />}</dd>
    </div>
  );
}

export function VitalsCard({
  visitId,
  observations,
  canWrite,
}: {
  visitId: VisitId;
  observations: readonly Observation[];
  canWrite: boolean;
}) {
  const record = useRecordObservations(visitId);
  const toast = useToast();
  const [kind, setKind] = useState<ObservationKind>("pulse");
  const [value, setValue] = useState("");

  const submit = () => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      return;
    }
    record.mutate(
      { readings: [{ kind, value: numeric }] },
      {
        onSuccess: () => {
          setValue("");
          toast.show({ title: "Reading recorded", tone: "success" });
        },
        onError: (thrown) => {
          toast.show({ title: apiErrorOf(thrown)?.message ?? "Couldn't record that reading.", tone: "danger" });
        },
      },
    );
  };

  return (
    <MkCard title="Vitals">
      {canWrite ? (
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <Field label="Reading" hideLabel className="w-40">
            <Select
              options={OBSERVATION_KINDS.map((k) => ({ value: k.value, label: k.label }))}
              value={kind}
              onValueChange={(next) => {
                setKind(next);
              }}
            />
          </Field>
          <Field label="Value" hideLabel className="w-32">
            <TextInput
              inputMode="decimal"
              value={value}
              onChange={(event) => {
                setValue(event.target.value);
              }}
            />
          </Field>
          <span className="pb-2.5 text-sm text-muted">{OBSERVATION_KINDS.find((k) => k.value === kind)?.unit}</span>
          <Button disabled={value.trim() === "" || record.isPending} onClick={submit}>
            {record.isPending ? "Saving…" : "Add"}
          </Button>
        </div>
      ) : null}
      {observations.length === 0 ? (
        <Empty title="No vitals recorded yet" />
      ) : (
        <ul className="flex flex-wrap gap-2">
          {observations.map((o) => (
            <Tag key={o.id}>
              {OBSERVATION_KINDS.find((k) => k.value === o.kind)?.label ?? o.kind}: {o.value} {o.unit}
            </Tag>
          ))}
        </ul>
      )}
    </MkCard>
  );
}

export function ProceduresCard({
  visitId,
  patientId,
  procedures,
  canWrite,
}: {
  visitId: VisitId;
  patientId: PatientId;
  procedures: readonly Procedure[];
  canWrite: boolean;
}) {
  const record = useRecordProcedure(visitId, patientId);
  const complete = useCompleteProcedure(visitId);
  const toast = useToast();
  const [name, setName] = useState("");
  const [tooth, setTooth] = useState("");

  const submit = () => {
    record.mutate(
      { name: name.trim(), ...(tooth.trim() === "" ? {} : { tooth: Number(tooth) }) },
      {
        onSuccess: () => {
          setName("");
          setTooth("");
          toast.show({ title: "Procedure recorded", tone: "success" });
        },
        onError: (thrown) => {
          toast.show({ title: apiErrorOf(thrown)?.message ?? "Couldn't record that procedure.", tone: "danger" });
        },
      },
    );
  };

  return (
    <MkCard title="Procedures">
      {canWrite ? (
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <Field label="Procedure" hideLabel className="w-56">
            <TextInput
              placeholder="Such as Composite filling"
              value={name}
              onChange={(event) => {
                setName(event.target.value);
              }}
            />
          </Field>
          <Field label="Tooth" hideLabel className="w-24">
            <TextInput
              placeholder="Tooth"
              inputMode="numeric"
              value={tooth}
              onChange={(event) => {
                setTooth(event.target.value);
              }}
            />
          </Field>
          <Button disabled={name.trim() === "" || record.isPending} onClick={submit}>
            {record.isPending ? "Saving…" : "Add"}
          </Button>
        </div>
      ) : null}
      {procedures.length === 0 ? (
        <Empty title="No procedures yet" />
      ) : (
        <ul className="divide-y divide-border">
          {procedures.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
              <span className="font-semibold text-text">
                {p.name}
                {p.tooth == null ? "" : ` · Tooth ${String(p.tooth)}`}
              </span>
              <span className="flex items-center gap-2">
                <Tag tone={statusTone(p.status === "done" ? "success" : p.status === "planned" ? "warning" : "neutral")}>{p.status}</Tag>
                {canWrite && p.status === "planned" ? (
                  <Button
                    variant="ghost"
                    icon={<Check aria-hidden="true" className="size-4" />}
                    disabled={complete.isPending}
                    onClick={() => {
                      complete.mutate(p.id, {
                        onError: (thrown) => {
                          toast.show({ title: apiErrorOf(thrown)?.message ?? "Couldn't complete that procedure.", tone: "danger" });
                        },
                      });
                    }}
                  >
                    Done
                  </Button>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      )}
    </MkCard>
  );
}
