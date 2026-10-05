import { Mic, Pause, Play, Square } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Button, Field, Meter, Select } from "@sakalya/ui";

import { DICTATION_LANGUAGES, MAX_RECORDING_SECONDS, clock, type DictationLanguage } from "./dictation.js";
import { useVoiceRecorder, type FinishedRecording } from "./use-voice-recorder.js";

export interface VoiceRecorderProps {
  /** Receives each settled piece of dictated text, to put into the draft at the cursor. */
  onInsert: (text: string) => void;
  /** Saves the recording with the note. Reject with a message to keep the recording on screen and let the doctor retry. */
  onKeep: (recording: FinishedRecording) => Promise<void>;
  /** Called when the doctor closes the recorder without a recording in hand. */
  onClose: () => void;
}

/**
 * Records the doctor's voice and dictates it into the note. The recording is kept with the note only when the
 * doctor chooses to keep it; dictated text goes straight into the draft, where it can be edited before signing.
 */
export function VoiceRecorder({ onInsert, onKeep, onClose }: VoiceRecorderProps) {
  const recorder = useVoiceRecorder(onInsert);
  const { phase, recording } = recorder;
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | undefined>(undefined);
  const previewUrl = useMemo(() => (recording === undefined ? undefined : URL.createObjectURL(recording.blob)), [recording]);
  useEffect(
    () => () => {
      if (previewUrl !== undefined) {
        URL.revokeObjectURL(previewUrl);
      }
    },
    [previewUrl],
  );

  const keep = () => {
    if (recording === undefined) {
      return;
    }
    setSaving(true);
    setSaveError(undefined);
    onKeep(recording)
      .catch((thrown: unknown) => {
        setSaveError(thrown instanceof Error ? thrown.message : "Couldn't save the recording. Please try again.");
      })
      .finally(() => {
        setSaving(false);
      });
  };

  const active = phase === "recording" || phase === "paused";
  const message = saveError ?? recorder.error;

  return (
    <section aria-label="Voice recorder" className="rounded-2xl border border-border bg-surface-muted p-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Language" className="w-44">
          <Select
            options={DICTATION_LANGUAGES.map((language) => ({ value: language.value, label: language.label }))}
            value={recorder.language}
            disabled={phase === "recording" || phase === "starting" || phase === "stopped"}
            onValueChange={(next: DictationLanguage) => {
              recorder.setLanguage(next);
            }}
          />
        </Field>
        {phase === "idle" || phase === "starting" ? (
          <>
            <Button
              icon={<Mic aria-hidden="true" className="size-4" />}
              disabled={phase === "starting"}
              onClick={() => {
                void recorder.start();
              }}
            >
              {phase === "starting" ? "Opening the microphone…" : "Start recording"}
            </Button>
            <Button variant="ghost" onClick={onClose}>
              Close
            </Button>
          </>
        ) : null}
        {active ? (
          <>
            {phase === "recording" ? (
              <Button
                variant="secondary"
                icon={<Pause aria-hidden="true" className="size-4" />}
                onClick={() => {
                  recorder.pause();
                }}
              >
                Pause
              </Button>
            ) : (
              <Button
                variant="secondary"
                icon={<Play aria-hidden="true" className="size-4" />}
                onClick={() => {
                  recorder.resume();
                }}
              >
                Resume
              </Button>
            )}
            <Button
              icon={<Square aria-hidden="true" className="size-4" />}
              onClick={() => {
                recorder.stop();
              }}
            >
              Stop
            </Button>
          </>
        ) : null}
      </div>

      {active ? (
        <div className="mt-3 flex flex-col gap-2">
          <p className="text-sm font-semibold text-text tabular-nums" role="timer" aria-label="Recording time">
            {phase === "paused" ? "Paused · " : "Recording · "}
            {clock(recorder.seconds)} / {clock(MAX_RECORDING_SECONDS)}
          </p>
          <Meter label="Microphone level" value={Math.round(recorder.level * 100)} max={100} valueLabel="" />
          <p aria-live="polite" className="min-h-5 text-sm text-muted">
            {recorder.interim === "" ? "" : `Hearing: ${recorder.interim}`}
          </p>
        </div>
      ) : null}

      {phase === "stopped" && recording !== undefined ? (
        <div className="mt-3 flex flex-col gap-3">
          <p className="text-sm text-text">
            Recorded {clock(recording.seconds)}. Dictated text is already in the note; keeping the recording saves the audio beside it.
          </p>
          {previewUrl === undefined ? null : <audio controls src={previewUrl} aria-label="Preview of the recording" className="w-full" />}
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              variant="secondary"
              disabled={saving}
              onClick={() => {
                setSaveError(undefined);
                recorder.discard();
              }}
            >
              Discard recording
            </Button>
            <Button disabled={saving} onClick={keep}>
              {saving ? "Saving…" : "Keep recording"}
            </Button>
          </div>
        </div>
      ) : null}

      {phase === "idle" && message === undefined ? (
        <p className="mt-3 text-sm text-muted">
          {recorder.dictationSupported
            ? "Speak and the words appear in the note as you go. You can edit them before signing."
            : "Live dictation isn't available in this browser, so only the recording is kept. Type the note yourself, or use Chrome or Edge to dictate."}
        </p>
      ) : null}
      {recorder.dictationNote === undefined || phase === "idle" ? null : (
        <p role="status" className="mt-3 text-sm text-muted">
          {recorder.dictationNote}
        </p>
      )}
      {message === undefined ? null : (
        <p role="alert" className="mt-3 text-sm font-medium text-danger-text">
          {message}
        </p>
      )}
    </section>
  );
}
