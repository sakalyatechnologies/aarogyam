import { useId, useState } from "react";

import { apiErrorOf } from "@aarogyam/api-client";
import { Button, Dialog, TextInput } from "@sakalya/ui";

import { useRecordSterilisationCycle, useSterilisationCycles } from "./queries.js";

/** The longest load note the server keeps. */
export const LOAD_NOTE_MAX = 120;

/** A tiny dialog: what was in the load (optional), then Save. The cycle is stamped with the time it is saved. */
export function LogCycleDialog({ onClose }: { onClose: () => void }) {
  const record = useRecordSterilisationCycle();
  const noteId = useId();
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title="Log a sterilisation cycle"
      description="Records that a cycle ran now."
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={record.isPending}
            onClick={() => {
              const text = note.trim();
              record.mutate(text === "" ? {} : { load_note: text }, {
                onSuccess: onClose,
                onError: (thrown) => {
                  setError(apiErrorOf(thrown)?.message ?? "Couldn't save that. Try again.");
                },
              });
            }}
          >
            Save
          </Button>
        </>
      }
    >
      <label htmlFor={noteId} className="tv2-sub">
        What was in the load (optional, no patient names)
      </label>
      <TextInput
        id={noteId}
        maxLength={LOAD_NOTE_MAX}
        value={note}
        onChange={(event) => {
          setNote(event.target.value);
        }}
      />
      <span className="tv2-sub" aria-live="polite">
        {String(note.length)}/{String(LOAD_NOTE_MAX)}
      </span>
      {error === undefined ? null : (
        <p role="alert" className="tv2-sub tv2-late">
          {error}
        </p>
      )}
    </Dialog>
  );
}

/** "Sterilisation: N cycles today · Log a cycle", for members who can use tasks. */
export function SterilisationLine() {
  const cycles = useSterilisationCycles();
  const [open, setOpen] = useState(false);
  const count = cycles.data?.items.length;
  return (
    <p className="tv2-sub tv2-sterilisation">
      {count === undefined ? "Sterilisation" : `Sterilisation: ${String(count)} ${count === 1 ? "cycle" : "cycles"} today`}
      {" · "}
      <button
        type="button"
        className="tv2-link"
        onClick={() => {
          setOpen(true);
        }}
      >
        Log a cycle
      </button>
      {open ? (
        <LogCycleDialog
          onClose={() => {
            setOpen(false);
          }}
        />
      ) : null}
    </p>
  );
}
