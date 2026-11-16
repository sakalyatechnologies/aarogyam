/**
 * A visit's notes in the history drawer, with their corrections. A note shows its latest version ("Edited 16 Nov by
 * Dr Dev") and lists the earlier versions read-only. A doctor can edit an unsigned draft of an open visit in place;
 * a signed note, or any note of a closed visit, is never overwritten: the edit is saved as a correction that keeps the
 * original (docs/decisions.md, 2026-11-16).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { apiErrorOf, unwrap, type Note, type Visit } from "@aarogyam/api-client";
import { formatDate } from "@aarogyam/app-kit";
import { Button, Field, TextArea, useToast } from "@sakalya/ui";

import { useClinic } from "../../../clinic.js";
import { inTimeOrder, splitNote } from "./note-lines.js";

const SECTIONS = [
  { key: "subjective", label: "Subjective" },
  { key: "objective", label: "Objective" },
  { key: "assessment", label: "Assessment" },
  { key: "plan", label: "Plan" },
] as const;
type Key = (typeof SECTIONS)[number]["key"];

function NoteText({ note }: { note: Note }) {
  const parts = splitNote(note.sections);
  return (
    <>
      {parts.voice.length === 0 ? null : (
        <ol aria-label="Voice notes" className="p360-voice-list">
          {inTimeOrder(parts.voice).map((line) => (
            <li key={`${String(line.index)}-${line.at}`}>
              <time className="mk-mono">{line.at}</time>
              <span>{line.text}</span>
            </li>
          ))}
        </ol>
      )}
      {parts.other.map(({ label, text }) => (
        <p key={label} className="p360-vd-text">
          <b>{label}: </b>
          {text}
        </p>
      ))}
    </>
  );
}

function Editor({ note, visit, inPlace, onDone }: { note: Note; visit: Visit; inPlace: boolean; onDone: () => void }) {
  const { api, access } = useClinic();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [values, setValues] = useState<Record<Key, string>>({
    subjective: note.sections.subjective ?? "",
    objective: note.sections.objective ?? "",
    assessment: note.sections.assessment ?? "",
    plan: note.sections.plan ?? "",
  });
  const [error, setError] = useState<string | undefined>(undefined);
  const save = useMutation({
    mutationFn: () => {
      const sections: Partial<Record<Key, string>> = {};
      for (const { key } of SECTIONS) {
        if (values[key].trim() !== "") sections[key] = values[key].trim();
      }
      return unwrap(inPlace ? api.editNote(note.id, { sections }) : api.amendNote(note.id, { sections }));
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["visit", access.org_id, visit.id] });
      void queryClient.invalidateQueries({ queryKey: ["note-versions", access.org_id] });
      void queryClient.invalidateQueries({ queryKey: ["timeline", access.org_id] });
      toast.show({ title: inPlace ? "Notes saved" : "Correction saved. The original is kept.", tone: "success" });
      onDone();
    },
    onError: (thrown) => {
      setError(apiErrorOf(thrown)?.message ?? "Couldn't save the notes. Please try again.");
    },
  });
  return (
    <form
      aria-label="Edit notes"
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        setError(undefined);
        save.mutate();
      }}
    >
      {inPlace ? null : (
        <p className="mk-hint" style={{ margin: 0 }}>
          This note is {note.status === "signed" ? "signed" : "part of a closed visit"}. Your changes are saved as a correction; the earlier version stays in the record.
        </p>
      )}
      {SECTIONS.map(({ key, label }) => (
        <Field key={key} label={label}>
          <TextArea
            rows={4}
            value={values[key]}
            onChange={(event) => {
              setValues((prev) => ({ ...prev, [key]: event.target.value }));
            }}
          />
        </Field>
      ))}
      {error === undefined ? null : (
        <p role="alert" className="mk-hint" style={{ color: "var(--red)", margin: 0 }}>
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? "Saving…" : inPlace ? "Save notes" : "Save correction"}
        </Button>
        <Button type="button" variant="secondary" disabled={save.isPending} onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** The versions a correction replaced, read when the doctor asks: visits list only the current note. */
function EarlierVersions({ note }: { note: Note }) {
  const { api, access } = useClinic();
  const [open, setOpen] = useState(false);
  const versions = useQuery({
    queryKey: ["note-versions", access.org_id, note.id],
    queryFn: ({ signal }) => unwrap(api.listNoteVersions(note.id, { signal })),
    enabled: open,
  });
  return (
    <details
      className="mt-2"
      onToggle={(event) => {
        setOpen(event.currentTarget.open);
      }}
    >
      <summary className="mk-link">See earlier versions</summary>
      {versions.isPending ? (
        <p className="mk-hint">Loading…</p>
      ) : versions.isError ? (
        <p role="alert" className="mk-hint" style={{ color: "var(--red)" }}>
          Couldn't load the earlier versions.
        </p>
      ) : (
        <ul aria-label="Earlier versions" className="m-0 mt-2 flex list-none flex-col gap-2 p-0">
          {versions.data.items.map((before) => (
            <li key={before.id} className="p360-vd-note">
              <p className="mk-hint" style={{ margin: "0 0 4px" }}>
                {before.author.name} · {formatDate(before.signed_at ?? before.created_at)} · replaced, kept for the record
              </p>
              <NoteText note={before} />
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}

function VersionBlock({ note, visit, canWrite }: { note: Note; visit: Visit; canWrite: boolean }) {
  const { session } = useClinic();
  const [editing, setEditing] = useState(false);
  const mine = note.author.id === session.membership.id;
  const closed = visit.status !== "open";
  // A draft of an open visit is its author's to change in place; everything else is corrected, never overwritten.
  const inPlace = note.status === "draft" && !closed;
  const canEdit = canWrite && (note.status === "signed" || (note.status === "draft" && (closed || mine)));
  return (
    <div className="p360-vd-note">
      <p className="mk-hint" style={{ margin: "0 0 4px" }}>
        {note.author.name} · {note.status === "signed" ? "Signed" : note.status === "draft" ? "Draft" : "Entered in error"}
        {note.supersedes_id == null ? "" : ` · Edited ${formatDate(note.created_at)} by ${note.author.name}`}
      </p>
      {editing ? (
        <Editor
          note={note}
          visit={visit}
          inPlace={inPlace}
          onDone={() => {
            setEditing(false);
          }}
        />
      ) : (
        <>
          <NoteText note={note} />
          {canEdit ? (
            <Button
              variant="secondary"
              onClick={() => {
                setEditing(true);
              }}
            >
              Edit notes
            </Button>
          ) : null}
        </>
      )}
      {note.supersedes_id == null ? null : <EarlierVersions note={note} />}
    </div>
  );
}

/** The notes of one visit as the server lists them (the current ones), earlier versions on request. */
export function VisitNotes({ notes, visit, canWrite }: { notes: readonly Note[]; visit: Visit; canWrite: boolean }) {
  const shown = notes.filter((note) => {
    const parts = splitNote(note.sections);
    return parts.voice.length + parts.other.length > 0 || note.status === "draft" || note.supersedes_id != null;
  });
  if (shown.length === 0) return <p className="mk-hint">No notes in this visit.</p>;
  return (
    <>
      {shown.map((note) => (
        <VersionBlock key={note.id} note={note} visit={visit} canWrite={canWrite} />
      ))}
    </>
  );
}
