/**
 * Voice notes for the open visit. Lives in the visit session (not in a block) so a recording keeps running while a
 * drawer or tab changes. Each note is one recording: it is stamped with the time it started, its dictated text is
 * added to the visit note as one `[HH:MM] text` line, and its audio is kept beside the note.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { apiErrorOf, type NoteId, type PatientId, type VisitId } from "@aarogyam/api-client";

import { useUploadRecording } from "../../visits/queries.js";
import type { DictationLanguage } from "../../visits/voice/dictation.js";
import { useVoiceRecorder, type RecorderPhase } from "../../visits/voice/use-voice-recorder.js";

/** `HH:MM` in the browser's clock: the start time a voice note is stamped with. */
export function stamp(at: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

export interface VoiceNotes {
  phase: RecorderPhase;
  /** Seconds recorded so far, not counting pauses. */
  seconds: number;
  /** Microphone level from 0 to 1. */
  level: number;
  language: DictationLanguage;
  setLanguage: (language: DictationLanguage) => void;
  dictationSupported: boolean;
  /** What has been dictated so far in this note. */
  transcript: string;
  /** Words still being recognised. */
  interim: string;
  /** Recording, paused or being saved: the visit must not end yet. */
  busy: boolean;
  saving: boolean;
  error: string | undefined;
  start: () => void;
  pause: () => void;
  resume: () => void;
  /** Stops, adds the text to the visit note stamped with its start time, and keeps the audio. */
  save: () => void;
  discard: () => void;
}

export function useVoiceNotes({
  patientId,
  visitId,
  addVoice,
}: {
  patientId: PatientId;
  visitId: VisitId | undefined;
  /** Adds one stamped line to the visit's draft note and returns the note's ID. */
  addVoice: (startedAt: Date, text: string) => Promise<NoteId | undefined>;
}): VoiceNotes {
  const [transcript, setTranscript] = useState("");
  const transcriptRef = useRef("");
  const startedAt = useRef(new Date());
  const [saving, setSaving] = useState(false);
  const wantSave = useRef(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const upload = useUploadRecording(patientId, visitId);
  const addVoiceRef = useRef(addVoice);
  useEffect(() => {
    addVoiceRef.current = addVoice;
  });

  const recorder = useVoiceRecorder((text) => {
    transcriptRef.current = `${transcriptRef.current} ${text}`.trim();
    setTranscript(transcriptRef.current);
  });
  const { phase, recording, discard: discardRecording } = recorder;
  const uploadAsync = upload.mutateAsync;

  const reset = useCallback(() => {
    transcriptRef.current = "";
    setTranscript("");
    setSaving(false);
    wantSave.current = false;
  }, []);

  // The recorder hands over the finished recording a moment after `stop`; then the note is written.
  useEffect(() => {
    if (!wantSave.current) return;
    if (phase === "idle") {
      // Stopped with nothing recorded (the microphone gave no audio): say so rather than saving an empty note.
      queueMicrotask(() => {
        reset();
        setError("Nothing was recorded, so there is nothing to save.");
      });
      return;
    }
    if (phase !== "stopped" || recording === undefined || visitId === undefined) return;
    wantSave.current = false;
    const text = transcriptRef.current.trim();
    void (async () => {
      let noteId: NoteId | undefined;
      try {
        noteId = await addVoiceRef.current(startedAt.current, text === "" ? "Voice note (no transcript)" : text);
        if (noteId === undefined) throw new Error("no note");
      } catch (thrown) {
        setError(apiErrorOf(thrown)?.message ?? "Couldn't save the voice note. Please try again.");
        setSaving(false);
        return;
      }
      try {
        await uploadAsync({ recording, target: { noteId, visitId } });
      } catch (thrown) {
        setError(`The note text is saved, but its audio wasn't kept: ${apiErrorOf(thrown)?.message ?? "the upload failed"}.`);
      }
      discardRecording();
      reset();
    })();
  }, [phase, recording, visitId, uploadAsync, discardRecording, reset]);

  const startRecorder = recorder.start;
  const start = useCallback(() => {
    setError(undefined);
    transcriptRef.current = "";
    setTranscript("");
    startedAt.current = new Date();
    void startRecorder();
  }, [startRecorder]);
  const stopRecorder = recorder.stop;
  const save = useCallback(() => {
    setError(undefined);
    wantSave.current = true;
    setSaving(true);
    stopRecorder();
  }, [stopRecorder]);
  const discard = useCallback(() => {
    discardRecording();
    reset();
  }, [discardRecording, reset]);

  return {
    phase,
    seconds: recorder.seconds,
    level: recorder.level,
    language: recorder.language,
    setLanguage: recorder.setLanguage,
    dictationSupported: recorder.dictationSupported,
    transcript,
    interim: recorder.interim,
    busy: phase === "starting" || phase === "recording" || phase === "paused" || saving,
    saving,
    error: error ?? recorder.error,
    start,
    pause: recorder.pause,
    resume: recorder.resume,
    save,
    discard,
  };
}
