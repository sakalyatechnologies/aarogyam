import { Pencil } from "lucide-react";
import { useRef, useState } from "react";
import { useNavigate } from "react-router";

import { apiErrorOf, type PatientId, type SummaryNote, type VisitNote } from "@aarogyam/api-client";
import { ApiErrorNotice, Markdown, formatDateTime, validateMarkdown } from "@aarogyam/app-kit";
import { Button, TextArea, useToast } from "@sakalya/ui";

import { MkCard, Tag, statusTone, Empty } from "../../components/mk/index.js";
import { MarkdownToolbar } from "../../components/markdown-toolbar.js";
import { SkeletonRows } from "../../components/skeleton-rows.js";
import { useClinic } from "../../clinic.js";
import { usePatientNotes, useSaveSummaryNote } from "./queries.js";

const MAX_SUMMARY = 20_000;

/** The patient's summary note, shown formatted, with an editor for anyone who may write clinical notes. */
function SummaryCard({ patientId, summary }: { patientId: PatientId; summary: SummaryNote | null | undefined }) {
  const { can } = useClinic();
  const toast = useToast();
  const save = useSaveSummaryNote(patientId);
  const [draft, setDraft] = useState<string | undefined>(undefined);
  // The version the editor started from: a save is refused if someone changed the note since.
  const [startedFrom, setStartedFrom] = useState<number | undefined>(undefined);
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const box = useRef<HTMLTextAreaElement | null>(null);
  const pendingSelection = useRef<{ start: number; end: number } | undefined>(undefined);
  const editing = draft !== undefined;
  const invalid = draft === undefined ? undefined : validateMarkdown(draft);

  const open = () => {
    setDraft(summary?.body ?? "");
    setStartedFrom(summary?.row_version);
    setProblem(undefined);
  };

  const onSave = () => {
    if (draft === undefined || invalid !== undefined) {
      return;
    }
    save.mutate(
      { body: draft, expectedVersion: startedFrom },
      {
        onSuccess: () => {
          setDraft(undefined);
          toast.show({ title: "Summary note saved", tone: "success" });
        },
        onError: (thrown) => {
          const error = apiErrorOf(thrown);
          setProblem(
            error?.status === 412
              ? "Someone else changed this note while you were editing. Copy your text, close the editor and open it again to see their version."
              : (error?.message ?? "Couldn't save the note. Please try again."),
          );
        },
      },
    );
  };

  return (
    <MkCard>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-base font-bold text-text">Summary note</h3>
        {can("clinical.write") && !editing ? (
          <Button variant="ghost" icon={<Pencil aria-hidden="true" className="size-4" />} onClick={open}>
            {summary == null ? "Write summary" : "Edit summary"}
          </Button>
        ) : null}
      </div>
      {editing ? (
        <div className="flex flex-col gap-2">
          <MarkdownToolbar
            label="the summary note"
            value={draft}
            box={() => box.current}
            onApply={(result) => {
              pendingSelection.current = { start: result.start, end: result.end };
              setDraft(result.value);
              requestAnimationFrame(() => {
                const element = box.current;
                const selection = pendingSelection.current;
                if (element != null && selection !== undefined) {
                  element.focus();
                  element.setSelectionRange(selection.start, selection.end);
                }
              });
            }}
          />
          <TextArea
            ref={box}
            aria-label="Summary note"
            rows={8}
            maxLength={MAX_SUMMARY}
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
              setProblem(undefined);
            }}
          />
          {invalid === undefined ? null : (
            <p role="alert" className="text-sm text-danger">
              {invalid}
            </p>
          )}
          {problem === undefined ? null : (
            <p role="alert" className="text-sm text-danger">
              {problem}
            </p>
          )}
          {draft.trim() === "" ? null : (
            <div className="rounded-md border border-border p-3" aria-label="Preview">
              <p className="mb-1 text-xs font-semibold text-muted">Preview</p>
              <Markdown text={draft} />
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                setDraft(undefined);
                setProblem(undefined);
              }}
            >
              Cancel
            </Button>
            <Button disabled={save.isPending || invalid !== undefined} onClick={onSave}>
              {save.isPending ? "Saving…" : "Save summary"}
            </Button>
          </div>
        </div>
      ) : summary == null || summary.body === "" ? (
        <p className="text-sm text-muted">No summary yet. Keep the patient's long-running picture here: history, preferences, what to watch.</p>
      ) : (
        <>
          <Markdown text={summary.body} />
          <p className="mt-2 text-xs text-muted">
            Updated {formatDateTime(summary.updated_at)}
            {summary.updated_by == null ? "" : ` by ${summary.updated_by}`}
          </p>
        </>
      )}
    </MkCard>
  );
}

const SECTION_LABELS = [
  ["subjective", "Subjective"],
  ["objective", "Objective"],
  ["assessment", "Assessment"],
  ["plan", "Plan"],
] as const;

/** One visit note. Drafts and addenda are handled on the visit, where the note is edited or signed. */
function VisitNoteCard({ patientId, note }: { patientId: PatientId; note: VisitNote }) {
  const navigate = useNavigate();
  return (
    <MkCard>
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <button
            type="button"
            className="text-left text-sm font-bold text-text hover:underline"
            onClick={() => {
              void navigate(`/patients/${patientId}/visits/${note.visit_id}`);
            }}
          >
            {note.visit_number} · {note.kind.replace("_", " ")}
          </button>
          <p className="text-xs text-muted">
            {note.author.name} · {formatDateTime(note.signed_at ?? note.created_at)}
          </p>
        </div>
        <Tag tone={statusTone(note.status === "signed" ? "success" : note.status === "draft" ? "neutral" : "danger")}>{note.status.replace("_", " ")}</Tag>
      </div>
      <dl className="grid gap-2 sm:grid-cols-2">
        {SECTION_LABELS.map(([key, label]) => {
          const value = note.sections[key];
          return value == null || value === "" ? null : (
            <div key={key}>
              <dt className="text-xs font-semibold text-muted">{label}</dt>
              <dd>
                <Markdown text={value} />
              </dd>
            </div>
          );
        })}
      </dl>
      {note.addenda_count === 0 ? null : (
        <p className="mt-2 text-xs text-muted">
          {note.addenda_count} {note.addenda_count === 1 ? "addendum" : "addenda"}: open the visit to read them.
        </p>
      )}
    </MkCard>
  );
}

/** Patient 360's Notes tab: the patient-level summary note, then the notes from each visit. */
export function NotesPanel({ patientId }: { patientId: PatientId }) {
  const notes = usePatientNotes(patientId);
  if (notes.isPending) {
    return <SkeletonRows count={3} label="Loading notes" />;
  }
  if (notes.isError) {
    return <ApiErrorNotice title="Couldn't load the notes" error={notes.error} onRetry={() => void notes.refetch()} />;
  }
  const { summary, visit_notes: visitNotes } = notes.data;
  return (
    <div className="flex flex-col gap-4">
      <SummaryCard patientId={patientId} summary={summary} />
      <h3 className="text-base font-bold text-text">Visit notes</h3>
      {visitNotes.length === 0 ? (
        <Empty title="No visit notes yet">Notes written in a visit appear here, newest first.</Empty>
      ) : (
        <ul className="flex flex-col gap-3" aria-label="Visit notes">
          {visitNotes.map((note) => (
            <li key={note.id}>
              <VisitNoteCard patientId={patientId} note={note} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
