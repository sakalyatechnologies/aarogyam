// moves to sakalya-web
import { formatHm, parseHm } from "../../lib/slots.js";
import { clockLabel } from "../../lib/time-grid.js";

export interface TimeSlotPickerProps {
  /** `HH:MM`, 24-hour; may be a custom time that is not one of the slots. */
  value: string;
  onChange: (time: string) => void;
  /** Free start times, minutes after midnight. */
  slots: readonly number[];
  /** Shown instead of the chips when there are none (or why: "Choose a doctor first"). */
  emptyNote?: string | undefined;
  loading?: boolean | undefined;
}

/** Free start times as chips under the time field; picking one fills the field, typing a custom time clears the highlight. */
export function TimeSlotPicker({ value, onChange, slots, emptyNote, loading = false }: TimeSlotPickerProps) {
  const current = parseHm(value);
  if (loading) return <p className="mk-ts-note">Checking the schedule…</p>;
  if (slots.length === 0) return <p className="mk-ts-note">{emptyNote ?? "No free times that day. Type a custom time above."}</p>;
  return (
    <div className="mk-ts-list" role="group" aria-label="Free start times">
      {slots.map((slot) => (
        <button
          key={slot}
          type="button"
          className="mk-ts-slot"
          aria-pressed={current === slot}
          onClick={() => {
            onChange(formatHm(slot));
          }}
        >
          {clockLabel(slot)}
        </button>
      ))}
    </div>
  );
}
