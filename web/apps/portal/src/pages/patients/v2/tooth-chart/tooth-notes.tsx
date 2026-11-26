import { Check } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { PatientId } from "@aarogyam/api-client";
import { formatDate } from "@aarogyam/app-kit";

import { useDictationLanguage } from "../../../../lib/dictation-language.js";
import { useNoteDictation } from "./use-note-dictation.js";
import { useToothNotes } from "./use-tooth-notes.js";

/**
 * The first thing on a tooth: a Notes box (type, or tap the mic) with no Save button. A new, non-empty note saves by itself when
 * the box loses focus, dictation stops, or the panel closes or moves to another tooth. Past notes are listed below, newest first.
 * Shown above both the panel and the treatment form, so a note written before choosing a treatment is the same note.
 */
export function ToothNotes({ patientId, tooth, canWrite, who }: { patientId: PatientId; tooth: number; canWrite: boolean; who: (id: string | null | undefined) => string | undefined }) {
  const notes = useToothNotes(patientId, tooth);
  const [text, setText] = useState("");
  const [saved, setSaved] = useState(false);
  const [failed, setFailed] = useState(false);
  const latest = useRef(text);
  const save = useRef(notes.save);
  useEffect(() => {
    save.current = notes.save;
  });
  const flush = () => {
    const body = latest.current.trim();
    if (body === "") return;
    latest.current = "";
    setText("");
    void save.current(body).then((ok) => {
      if (ok) {
        setFailed(false);
        setSaved(true);
      } else {
        // Keep the words: put them back unless more has been typed since.
        setFailed(true);
        if (latest.current === "") {
          latest.current = body;
          setText(body);
        }
      }
    });
  };
  // Closing the panel or picking another tooth unmounts this box: that saves too.
  const flushRef = useRef(flush);
  useEffect(() => {
    flushRef.current = flush;
  });
  useEffect(
    () => () => {
      flushRef.current();
    },
    [],
  );

  const [firstLanguage] = useDictationLanguage();
  const dictation = useNoteDictation({
    language: firstLanguage,
    onPhrase: (phrase) => {
      const before = latest.current.trim();
      const next = before === "" ? phrase : `${before} ${phrase}`;
      latest.current = next;
      setText(next);
      setSaved(false);
    },
    onEnd: () => {
      flushRef.current();
    },
  });

  return (
    <section className="tc-notes" aria-label={`Notes for tooth ${String(tooth)}`}>
      <div className="tc-note">
        <textarea
          aria-label="Notes"
          rows={2}
          maxLength={2000}
          value={text}
          disabled={!canWrite || !notes.supported}
          placeholder="Notes, e.g. deep caries distal, sensitive to cold"
          onChange={(event) => {
            latest.current = event.target.value;
            setText(event.target.value);
            setSaved(false);
          }}
          onBlur={flush}
        />
        {dictation.available && canWrite && notes.supported ? (
          <button
            type="button"
            className="tc-mic"
            aria-pressed={dictation.listening}
            aria-label={dictation.listening ? "Stop dictating the note" : "Dictate a note"}
            onClick={() => {
              if (dictation.listening) dictation.stop();
              else dictation.start();
            }}
          >
            <span aria-hidden="true">🎤</span>
          </button>
        ) : null}
      </div>
      {dictation.listening ? (
        <p className="tc-meta tc-heard" aria-live="polite">
          {dictation.interim === "" ? "Listening… tap the mic again to finish." : dictation.interim}
        </p>
      ) : null}
      {dictation.problem === undefined ? null : (
        <p role="alert" className="tc-meta">
          {dictation.problem}
        </p>
      )}
      <div role="status" aria-live="polite" className="tc-meta">
        {failed ? "Couldn't save the note. It stays here; tap outside the box to try again." : saved ? (
          <span className="tc-saved">
            <Check aria-hidden="true" className="size-3.5" /> Saved
          </span>
        ) : null}
      </div>
      {notes.notes.length === 0 ? null : (
        <ol className="tc-notes-list" aria-label={`Past notes on tooth ${String(tooth)}`}>
          {notes.notes.map((note) => (
            <li key={note.id}>
              <span className="tc-meta">{[formatDate(note.recorded_at), note.recorded_by_name ?? who(note.recorded_by)].filter((p) => p != null).join(" · ")}</span>
              <p>{note.body}</p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
