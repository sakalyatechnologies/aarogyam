import { Check, Lock, MessageSquarePlus, Plus } from "lucide-react";
import { useState } from "react";
import { useParams } from "react-router";

import {
  apiErrorOf,
  patientId as parsePatientId,
  visitId as parseVisitId,
  type Note,
  type NoteId,
  type Observation,
  type ObservationKind,
  type PatientId,
  type Procedure,
  type VisitId,
} from "@aarogyam/api-client";
import { ApiErrorNotice, formatDateTime, useDocumentTitle } from "@aarogyam/app-kit";
import { Button, Card, Dialog, EmptyState, Field, PageHeader, Pill, Select, Skeleton, TextArea, TextInput, useToast } from "@sakalya/ui";

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
import { useAddAddendum } from "./queries.js";

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
    return (
      <div role="status" aria-label="Loading the visit">
        <Skeleton shape="block" />
      </div>
    );
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

  return (
    <>
      <PageHeader
        title={`Visit ${visit.number}`}
        subtitle={`${formatDateTime(visit.started_at)} · ${visit.clinician.name}`}
        end={
          <div className="flex items-center gap-2">
            <Pill tone={isOpen ? "warning" : "success"}>{isOpen ? "Open" : "Closed"}</Pill>
            {canWrite && isOpen ? (
              <Button
                variant="secondary"
                disabled={close.isPending}
                onClick={() => {
                  close.mutate(undefined, {
                    onSuccess: () => {
                      toast.show({ title: "Visit closed", tone: "success" });
                    },
                    onError: (thrown) => {
                      toast.show({ title: apiErrorOf(thrown)?.message ?? "Couldn't close that visit.", tone: "danger" });
                    },
                  });
                }}
              >
                {close.isPending ? "Closing…" : "Close visit"}
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
        <NotesCard visitId={visit.id} notes={detail.notes} canWrite={canWrite && isOpen} canAddend={canWrite} />
        <VitalsCard visitId={visit.id} observations={detail.observations} canWrite={canWrite && isOpen} />
        <ProceduresCard visitId={visit.id} patientId={patientId} procedures={detail.procedures} canWrite={canWrite && isOpen} />
        {can("clinical.read") ? <TreatmentPlansCard patientId={patientId} visitId={visit.id} visitOpen={isOpen} canWrite={canWrite} /> : null}
        {detail.chart_entries.length === 0 ? null : (
          <Card title="Dental chart entries in this visit">
            <ul className="flex flex-col gap-1.5 text-sm">
              {detail.chart_entries.map((entry) => (
                <li key={entry.id}>
                  Tooth {entry.tooth}
                  {entry.surface == null ? "" : ` (${entry.surface})`}: <span className="font-semibold text-text">{entry.finding}</span>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </>
  );
}

function NotesCard({ visitId, notes, canWrite, canAddend }: { visitId: VisitId; notes: readonly Note[]; canWrite: boolean; canAddend: boolean }) {
  const createNote = useCreateNote(visitId);
  const [drafting, setDrafting] = useState(false);
  const toast = useToast();

  return (
    <Card
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
        <EmptyState title="No notes yet" icon={null} />
      ) : (
        <div className="flex flex-col gap-4">
          {notes.map((note) => (
            <NoteCard key={note.id} visitId={visitId} note={note} canAddend={canAddend} />
          ))}
        </div>
      )}
    </Card>
  );
}

function NoteCard({ visitId, note, canAddend }: { visitId: VisitId; note: Note; canAddend: boolean }) {
  const sign = useSignNote(visitId);
  const [addending, setAddending] = useState(false);
  const toast = useToast();
  const sections = note.sections;
  const isDraft = note.status === "draft";

  const onSign = (id: NoteId) => {
    sign.mutate(id, {
      onSuccess: () => {
        toast.show({ title: "Note signed", tone: "success" });
      },
      onError: (thrown) => {
        toast.show({ title: apiErrorOf(thrown)?.message ?? "Couldn't sign that note.", tone: "danger" });
      },
    });
  };

  return (
    <div className="rounded-2xl border border-border p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-sm font-bold text-text">{note.kind.toUpperCase()}</p>
        <Pill tone={note.status === "signed" ? "success" : note.status === "draft" ? "neutral" : "danger"}>{note.status}</Pill>
      </div>
      <dl className="grid gap-2 text-sm sm:grid-cols-2">
        <NoteSection label="Subjective" value={sections.subjective} />
        <NoteSection label="Objective" value={sections.objective} />
        <NoteSection label="Assessment" value={sections.assessment} />
        <NoteSection label="Plan" value={sections.plan} />
      </dl>
      {note.addenda.length === 0 ? null : (
        <div className="mt-3 border-t border-border pt-3">
          <h4 className="text-xs font-semibold text-muted">Addenda</h4>
          <ul aria-label="Addenda" className="mt-1 flex flex-col gap-2">
            {note.addenda.map((a) => (
              <li key={a.id} className="text-sm">
                <p className="text-text">{a.body}</p>
                <p className="text-xs text-muted">
                  {a.author.name} · {formatDateTime(a.created_at)}
                </p>
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

function AddendumDialog({ visitId, noteId, onOpenChange }: { visitId: VisitId; noteId: NoteId; onOpenChange: () => void }) {
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);
  const add = useAddAddendum(visitId);
  const toast = useToast();

  const submit = () => {
    setError(undefined);
    add.mutate(
      { id: noteId, body: body.trim() },
      {
        onSuccess: () => {
          toast.show({ title: "Addendum added", tone: "success" });
          onOpenChange();
        },
        onError: (thrown) => {
          setError(apiErrorOf(thrown)?.message ?? "Couldn't add that addendum. Please try again.");
        },
      },
    );
  };

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
          <Button onClick={submit} disabled={body.trim() === "" || add.isPending}>
            {add.isPending ? "Saving…" : "Save"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Addendum" required hint="A signed note never changes; this is added beneath it.">
          <TextArea
            value={body}
            onChange={(event) => {
              setBody(event.target.value);
            }}
          />
        </Field>
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
      <dd className="text-text">{value == null || value === "" ? "—" : value}</dd>
    </div>
  );
}

function VitalsCard({
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
    <Card title="Vitals">
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
        <EmptyState title="No vitals recorded yet" icon={null} />
      ) : (
        <ul className="flex flex-wrap gap-2">
          {observations.map((o) => (
            <Pill key={o.id} tone="neutral">
              {OBSERVATION_KINDS.find((k) => k.value === o.kind)?.label ?? o.kind}: {o.value} {o.unit}
            </Pill>
          ))}
        </ul>
      )}
    </Card>
  );
}

function ProceduresCard({
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
    <Card title="Procedures">
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
        <EmptyState title="No procedures yet" icon={null} />
      ) : (
        <ul className="divide-y divide-border">
          {procedures.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
              <span className="font-semibold text-text">
                {p.name}
                {p.tooth == null ? "" : ` · Tooth ${String(p.tooth)}`}
              </span>
              <span className="flex items-center gap-2">
                <Pill tone={p.status === "done" ? "success" : p.status === "planned" ? "warning" : "neutral"}>{p.status}</Pill>
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
    </Card>
  );
}
