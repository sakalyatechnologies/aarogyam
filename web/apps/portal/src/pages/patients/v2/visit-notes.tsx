/**
 * The lines of today's note, spoken and typed together, in time order, and the box to type one. Both kinds are stored
 * the same way, as `[HH:MM] text` lines in the note's subjective section, so older screens and the phone app read
 * them unchanged. While the note is a draft in an open visit each line can be edited or removed.
 */
import { Check, Pencil, Trash2, X } from "lucide-react";
import { useState } from "react";

import { apiErrorOf } from "@aarogyam/api-client";
import { Button, TextInput } from "@sakalya/ui";

import { inTimeOrder, withLine, type NoteLine } from "./note-lines.js";
import { useVisitSession } from "./visit-session.js";

export function TypeNote() {
  const { note, visit } = useVisitSession();
  const [text, setText] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  if (visit === undefined) return null;
  const add = () => {
    const line = text.trim();
    if (line === "" || adding) return;
    setAdding(true);
    setError(undefined);
    note.addVoice(new Date(), line).then(
      () => {
        setText("");
        setAdding(false);
      },
      (thrown: unknown) => {
        setError(apiErrorOf(thrown)?.message ?? "Couldn't add the note. Please try again.");
        setAdding(false);
      },
    );
  };
  return (
    <form
      aria-label="Type a note"
      className="flex flex-col gap-1"
      onSubmit={(event) => {
        event.preventDefault();
        add();
      }}
    >
      <div className="flex items-center gap-2">
        <TextInput
          aria-label="Type a note"
          placeholder="Type a note…"
          value={text}
          maxLength={2000}
          onChange={(event) => {
            setText(event.currentTarget.value);
          }}
        />
        <Button type="submit" variant="secondary" disabled={text.trim() === "" || adding}>
          {adding ? "Adding…" : "Add"}
        </Button>
      </div>
      {error === undefined ? null : (
        <p role="alert" className="mk-hint" style={{ color: "var(--red)", margin: 0 }}>
          {error}
        </p>
      )}
    </form>
  );
}

function Line({ line, editable }: { line: NoteLine; editable: boolean }) {
  const { note } = useVisitSession();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(line.text);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const change = (next: string | undefined) => {
    setBusy(true);
    setError(undefined);
    note.rewrite("subjective", (current) => withLine(current, line.index, line.at, next, line.text)).then(
      () => {
        setBusy(false);
        setEditing(false);
      },
      (thrown: unknown) => {
        setError(apiErrorOf(thrown)?.message ?? "Couldn't save the change. Please try again.");
        setBusy(false);
      },
    );
  };
  if (editing) {
    return (
      <li>
        <time className="mk-mono">{line.at}</time>
        <form
          className="flex flex-1 items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (text.trim() === "") return;
            change(text.trim());
          }}
        >
          <TextInput
            aria-label={`Edit the note at ${line.at}`}
            value={text}
            onChange={(event) => {
              setText(event.currentTarget.value);
            }}
          />
          <Button type="submit" variant="secondary" aria-label={`Save the note at ${line.at}`} disabled={busy || text.trim() === ""} icon={<Check aria-hidden="true" className="size-4" />}>
            Save
          </Button>
          <Button
            type="button"
            variant="ghost"
            aria-label={`Cancel editing the note at ${line.at}`}
            icon={<X aria-hidden="true" className="size-4" />}
            onClick={() => {
              setText(line.text);
              setEditing(false);
            }}
          >
            Cancel
          </Button>
        </form>
        {error === undefined ? null : <span role="alert" className="mk-hint" style={{ color: "var(--red)" }}>{error}</span>}
      </li>
    );
  }
  return (
    <li>
      <time className="mk-mono">{line.at}</time>
      <span className="flex-1">{line.text}</span>
      {editable ? (
        <span className="flex gap-2">
          <button
            type="button"
            className="mk-link p360-line-btn"
            aria-label={`Edit the note at ${line.at}`}
            disabled={busy}
            onClick={() => {
              setText(line.text);
              setEditing(true);
            }}
          >
            <Pencil aria-hidden="true" className="size-4" />
          </button>
          <button
            type="button"
            className="mk-link p360-line-btn"
            aria-label={`Delete the note at ${line.at}`}
            disabled={busy}
            onClick={() => {
              change(undefined);
            }}
          >
            <Trash2 aria-hidden="true" className="size-4" />
          </button>
        </span>
      ) : null}
      {error === undefined ? null : <span role="alert" className="mk-hint" style={{ color: "var(--red)" }}>{error}</span>}
    </li>
  );
}

/** Every spoken and typed line of today's note, in time order. */
export function TranscriptLines({ lines }: { lines: readonly NoteLine[] }) {
  const { note, canWrite, visit } = useVisitSession();
  const editable = canWrite && note.hasDraft && visit?.status === "open";
  return (
    <ol aria-label="Voice notes" className="p360-voice-list">
      {inTimeOrder(lines).map((line) => (
        <Line key={`${String(line.index)}-${line.at}-${line.text}`} line={line} editable={editable} />
      ))}
    </ol>
  );
}
