import { useEffect, useRef, useState } from "react";

import { randomUuid, type ChartEntry, type NewToothStatus, type PatientId, type ToothStatus } from "@aarogyam/api-client";
import { formatDate } from "@aarogyam/app-kit";
import { Button, useToast } from "@sakalya/ui";

import { useClearToothStatus, useSetToothStatus } from "../../../../queries.js";
import { HEALTHS, TREAT_WITHIN, derivedHealth, healthLabel, type Health } from "./model.js";
import { useDictationLanguage } from "../../../../lib/dictation-language.js";
import { DICTATION_LANGUAGES } from "../../../visits/voice/dictation.js";
import { useNoteDictation } from "./use-note-dictation.js";

export interface HealthChoice {
  health: Health;
  note: string;
  months: number | undefined;
}

/** Saves a tooth's health optimistically, with a toast; `undo` puts back what was there before (or clears the override). */
export function useToothHealthSaver(patientId: PatientId) {
  const set = useSetToothStatus(patientId);
  const clear = useClearToothStatus(patientId);
  const toast = useToast();
  const failed = () => {
    toast.show({ title: "Couldn't save the tooth's health. Please try again.", tone: "danger" });
  };
  const save = (tooth: number, choice: HealthChoice, onSaved?: () => void) => {
    const note = choice.note.trim();
    const months = choice.health === "healthy" ? undefined : choice.months;
    const input: NewToothStatus = { health: choice.health, client_id: randomUuid(), ...(note === "" ? {} : { note }), ...(months === undefined ? {} : { treat_within_months: months }) };
    const shown: ToothStatus = { tooth, health: choice.health, recorded_at: new Date().toISOString(), ...(note === "" ? {} : { note }), ...(months === undefined ? {} : { treat_within_months: months }) };
    set.mutate(
      { tooth, input, status: shown },
      {
        onSuccess: () => {
          toast.show({ title: `Tooth ${String(tooth)}: ${healthLabel(choice.health)}`, tone: "success" });
          onSaved?.();
        },
        onError: failed,
      },
    );
  };
  const undo = (tooth: number, before: ToothStatus | undefined, onDone: () => void) => {
    const done = {
      onSuccess: () => {
        toast.show({ title: `Tooth ${String(tooth)}: undone`, tone: "success" });
        onDone();
      },
      onError: failed,
    };
    if (before === undefined) {
      clear.mutate(tooth, done);
      return;
    }
    save(tooth, { health: before.health, note: before.note ?? "", months: before.treat_within_months ?? undefined }, onDone);
  };
  return { save, undo, busy: set.isPending || clear.isPending };
}

interface Props {
  patientId: PatientId;
  tooth: number;
  /** The tooth's current chart entries. */
  entries: readonly ChartEntry[];
  status: ToothStatus | undefined;
  canWrite: boolean;
  who: (id: string | null | undefined) => string | undefined;
  /** Start dictating into the note at once (a long press on the tooth). */
  dictate: boolean;
  onDictateStarted: () => void;
}

/**
 * The top of the tooth panel: Healthy / Watch / Needs treatment. The health the chart suggests shows dashed; one tap saves an
 * override. A one-line note (typed or dictated) saves on Enter or when dictation stops, never on blur. No visit is needed.
 */
export function HealthRow({ patientId, tooth, entries, status, canWrite, who, dictate, onDictateStarted }: Props) {
  const saver = useToothHealthSaver(patientId);
  const derived = derivedHealth(entries);
  const suggested: Health | undefined = derived === "none" || derived === "unassessed" ? undefined : derived;
  const health = status?.health ?? suggested;
  const [note, setNote] = useState(status?.note ?? "");
  const [months, setMonths] = useState<number | undefined>(status?.treat_within_months ?? undefined);
  const [hint, setHint] = useState<string | undefined>(undefined);
  const [undo, setUndo] = useState<{ before: ToothStatus | undefined } | undefined>(undefined);
  const noteRef = useRef(note);
  useEffect(() => {
    noteRef.current = note;
  }, [note]);

  const choose = (picked: Health, next: Partial<HealthChoice> = {}) => {
    const before = status;
    setHint(undefined);
    saver.save(tooth, { health: picked, note: next.note ?? noteRef.current, months: "months" in next ? next.months : months }, () => {
      setUndo({ before });
    });
  };
  const saveNote = (text: string) => {
    if (!canWrite) return;
    if (health === undefined) {
      setHint("Pick Healthy, Watch or Needs treatment to save the note.");
      return;
    }
    if (text.trim() === (status?.note ?? "").trim() && status !== undefined) return;
    choose(health, { note: text });
  };
  // Starts in the language set under My profile; switching here lasts for this tooth only.
  const [firstLanguage] = useDictationLanguage();
  const [language, setLanguage] = useState<string>(firstLanguage);
  const dictation = useNoteDictation({
    language,
    onPhrase: (phrase) => {
      // Straight from the ref, so a phrase kept on stop is already in the note that onEnd saves.
      const before = noteRef.current.trim();
      const next = before === "" ? phrase : `${before} ${phrase}`;
      noteRef.current = next;
      setNote(next);
    },
    onEnd: () => {
      saveNote(noteRef.current);
    },
  });
  const { available, start } = dictation;
  useEffect(() => {
    if (!dictate) return;
    onDictateStarted();
    if (canWrite && available) start();
  }, [dictate, canWrite, available, start, onDictateStarted]);

  const advise = health === "watch" || health === "needs_treatment";
  const by = status === undefined ? undefined : who(status.recorded_by);

  return (
    <section className="tc-health" aria-label={`Health of tooth ${String(tooth)}`}>
      <div className="tc-health-chips" role="group" aria-label="Health">
        {HEALTHS.map((h) => (
          <button
            key={h.value}
            type="button"
            className="tc-health-chip"
            data-health={h.value}
            data-suggested={(status === undefined && suggested === h.value) || undefined}
            aria-pressed={status?.health === h.value}
            aria-keyshortcuts={h.key}
            disabled={!canWrite || saver.busy}
            onClick={() => {
              if (status?.health !== h.value) choose(h.value);
            }}
          >
            <b aria-hidden="true">{h.glyph}</b>
            {h.label}
          </button>
        ))}
      </div>
      {status === undefined ? (
        <p className="tc-meta">{suggested === undefined ? "Not assessed yet." : `${healthLabel(suggested)}, suggested from the chart.`}</p>
      ) : (
        <p className="tc-meta">{[healthLabel(status.health), by === undefined ? undefined : `by ${by}`, formatDate(status.recorded_at)].filter((p) => p !== undefined).join(" · ")}</p>
      )}
      {status?.treat_within_months == null ? null : (
        <p className="tc-meta">{`${by === undefined ? "The doctor" : by} advises treatment within ${String(status.treat_within_months)} ${status.treat_within_months === 1 ? "month" : "months"}.`}</p>
      )}
      <form
        className="tc-note"
        aria-label={`Note for tooth ${String(tooth)}`}
        onSubmit={(event) => {
          event.preventDefault();
          saveNote(note);
        }}
      >
        <input
          aria-label="Quick note"
          value={note}
          maxLength={500}
          placeholder="Quick note, e.g. deep caries distal"
          disabled={!canWrite}
          onChange={(event) => {
            setNote(event.target.value);
          }}
        />
        {available && canWrite ? (
          <button
            type="button"
            className="tc-mic"
            aria-pressed={dictation.listening}
            aria-label={dictation.listening ? "Stop dictating" : "Dictate the note"}
            onClick={() => {
              if (dictation.listening) dictation.stop();
              else start();
            }}
          >
            <span aria-hidden="true">🎤</span>
          </button>
        ) : null}
        {available && canWrite ? (
          <select
            className="tc-lang"
            aria-label="Dictation language"
            value={language}
            onChange={(event) => {
              if (dictation.listening) dictation.stop();
              setLanguage(event.target.value);
            }}
          >
            {DICTATION_LANGUAGES.map((l) => (
              <option key={l.value} value={l.value}>
                {l.value.slice(0, 2).toUpperCase()}
              </option>
            ))}
          </select>
        ) : null}
      </form>
      {dictation.listening ? (
        <p className="tc-meta tc-heard" aria-live="polite">
          {dictation.interim === "" ? "Listening… tap the mic again to save." : dictation.interim}
        </p>
      ) : null}
      {dictation.problem === undefined ? null : (
        <p role="alert" className="tc-meta">
          {dictation.problem}
        </p>
      )}
      {hint === undefined ? null : (
        <p role="alert" className="tc-meta">
          {hint}
        </p>
      )}
      {advise && canWrite ? (
        <div className="tc-within" role="group" aria-label="Advise treatment within">
          <span>Advise treatment within</span>
          {TREAT_WITHIN.map((m) => (
            <button
              key={m}
              type="button"
              className="p360-chip"
              aria-pressed={months === m}
              disabled={saver.busy}
              onClick={() => {
                const next = months === m ? undefined : m;
                setMonths(next);
                choose(health, { months: next });
              }}
            >
              {`${String(m)} mo`}
            </button>
          ))}
        </div>
      ) : null}
      <div role="status" aria-live="polite">
        {undo === undefined ? null : (
          <Button
            variant="secondary"
            disabled={saver.busy}
            onClick={() => {
              saver.undo(tooth, undo.before, () => {
                setUndo(undefined);
                setNote(undo.before?.note ?? "");
                setMonths(undo.before?.treat_within_months ?? undefined);
              });
            }}
          >
            Undo
          </Button>
        )}
      </div>
    </section>
  );
}
