import { Mic } from "lucide-react";
import { useImperativeHandle, useLayoutEffect, useRef, useState, type Ref } from "react";

import { apiErrorOf, type Note, type NoteContent, type PatientId, type VisitId } from "@aarogyam/api-client";
import { Button, Field, TextArea, useToast } from "@sakalya/ui";

import { useEditNote, useUploadRecording } from "./queries.js";
import { insertAt } from "./voice/dictation.js";
import { VoiceRecorder } from "./voice/voice-recorder.js";

const SECTIONS = [
  { key: "subjective", label: "Subjective" },
  { key: "objective", label: "Objective" },
  { key: "assessment", label: "Assessment" },
  { key: "plan", label: "Plan" },
] as const;

type SectionKey = (typeof SECTIONS)[number]["key"];
type Values = Record<SectionKey, string>;

function valuesOf(note: Note): Values {
  return {
    subjective: note.sections.subjective ?? "",
    objective: note.sections.objective ?? "",
    assessment: note.sections.assessment ?? "",
    plan: note.sections.plan ?? "",
  };
}

function contentOf(values: Values): NoteContent {
  const sections: Record<string, string> = {};
  for (const { key } of SECTIONS) {
    if (values[key].trim() !== "") {
      sections[key] = values[key].trim();
    }
  }
  return { sections };
}

/** What a parent needs to save pending edits before it signs the note. */
export interface DraftHandle {
  save: () => Promise<void>;
}

/**
 * A draft note's four sections as text boxes, with a voice recorder that dictates into whichever box the cursor
 * was last in. The kept recording is saved beside the note; the note's text is only what the doctor leaves in the boxes.
 */
export function DraftNoteEditor({
  patientId,
  visitId,
  note,
  openRecorder,
  handle,
}: {
  patientId: PatientId;
  visitId: VisitId;
  note: Note;
  /** A token that changes with each request to open the recorder, so asking again reopens it after it was closed. */
  openRecorder?: string | undefined;
  handle?: Ref<DraftHandle>;
}) {
  const edit = useEditNote(visitId);
  const upload = useUploadRecording(patientId, visitId);
  const toast = useToast();
  const [values, setValues] = useState<Values>(() => valuesOf(note));
  const latest = useRef<Values>(values);
  const saved = useRef<Values>(valuesOf(note));
  const [dirty, setDirty] = useState(false);
  const [recording, setRecording] = useState(false);
  const [seenRequest, setSeenRequest] = useState<string | undefined>(undefined);
  if (openRecorder !== seenRequest) {
    setSeenRequest(openRecorder);
    if (openRecorder !== undefined) {
      setRecording(true);
    }
  }
  const boxes = useRef<Partial<Record<SectionKey, HTMLTextAreaElement | null>>>({});
  const focused = useRef<SectionKey>("subjective");
  const selection = useRef<Partial<Record<SectionKey, { start: number; end: number }>>>({});
  const cursorAfterInsert = useRef<{ key: SectionKey; at: number } | undefined>(undefined);
  const [counter, setCounter] = useState(0);

  const change = (key: SectionKey, value: string) => {
    latest.current = { ...latest.current, [key]: value };
    setValues(latest.current);
    setDirty(SECTIONS.some((s) => latest.current[s.key] !== saved.current[s.key]));
  };

  const remember = (key: SectionKey) => {
    const box = boxes.current[key];
    if (box != null) {
      focused.current = key;
      selection.current[key] = { start: box.selectionStart, end: box.selectionEnd };
    }
  };

  /** Puts dictated text into the section last used, at its cursor (or at the end when it was never focused). */
  const insert = (text: string) => {
    const key = focused.current;
    const current = latest.current[key];
    const at = selection.current[key] ?? { start: current.length, end: current.length };
    const next = insertAt(current, at.start, at.end, text);
    selection.current[key] = { start: next.cursor, end: next.cursor };
    cursorAfterInsert.current = { key, at: next.cursor };
    change(key, next.value);
    setCounter((n) => n + 1);
  };

  useLayoutEffect(() => {
    const pending = cursorAfterInsert.current;
    if (pending === undefined) {
      return;
    }
    cursorAfterInsert.current = undefined;
    const box = boxes.current[pending.key];
    if (box != null && document.activeElement === box) {
      box.setSelectionRange(pending.at, pending.at);
    }
  }, [counter]);

  const save = async () => {
    if (SECTIONS.every((s) => latest.current[s.key] === saved.current[s.key])) {
      return;
    }
    const sent = latest.current;
    await edit.mutateAsync({ id: note.id, content: contentOf(sent) });
    saved.current = sent;
    setDirty(SECTIONS.some((s) => latest.current[s.key] !== saved.current[s.key]));
  };
  useImperativeHandle(handle, () => ({ save }));

  const keep = async (finished: Parameters<React.ComponentProps<typeof VoiceRecorder>["onKeep"]>[0]) => {
    try {
      // The dictated text is saved first, so a failed upload never loses it.
      await save();
      await upload.mutateAsync({ recording: finished, target: { noteId: note.id, visitId } });
    } catch (thrown) {
      throw new Error(apiErrorOf(thrown)?.message ?? "Couldn't save the recording. Please try again.", { cause: thrown });
    }
    toast.show({ title: "Recording kept with the note", tone: "success" });
    setRecording(false);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        {SECTIONS.map(({ key, label }) => (
          <Field key={key} label={label}>
            <TextArea
              rows={3}
              value={values[key]}
              ref={(element) => {
                boxes.current[key] = element;
              }}
              onChange={(event) => {
                change(key, event.target.value);
                remember(key);
              }}
              onFocus={() => {
                remember(key);
              }}
              onSelect={() => {
                remember(key);
              }}
              onBlur={() => {
                remember(key);
              }}
            />
          </Field>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        {recording ? null : (
          <Button
            variant="secondary"
            icon={<Mic aria-hidden="true" className="size-4" />}
            onClick={() => {
              setRecording(true);
            }}
          >
            Record voice
          </Button>
        )}
        <Button
          variant="secondary"
          disabled={!dirty || edit.isPending}
          onClick={() => {
            save().then(
              () => {
                toast.show({ title: "Draft saved", tone: "success" });
              },
              (thrown: unknown) => {
                toast.show({ title: apiErrorOf(thrown)?.message ?? "Couldn't save the draft.", tone: "danger" });
              },
            );
          }}
        >
          {edit.isPending ? "Saving…" : "Save draft"}
        </Button>
      </div>
      {recording ? (
        <VoiceRecorder
          onInsert={insert}
          onKeep={keep}
          onClose={() => {
            setRecording(false);
          }}
        />
      ) : null}
    </div>
  );
}
