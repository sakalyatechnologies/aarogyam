import { Field, TextInput } from "@sakalya/ui";

import "../../components/quick-picks.css";

/** The longest reason the API takes. */
export const REASON_MAX = 200;
/** Quick picks; "Other" leaves the text for the desk to type. */
export const REASON_CHIPS = ["Toothache", "Check-up", "Cleaning", "Follow-up", "Other"] as const;

/** Why the patient came: a few chips and a free-text line, both optional. */
export function ReasonField({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  return (
    <div className="wi-section">
      <Field label="Reason for visit" hint="Optional">
        <TextInput
          autoComplete="off"
          maxLength={REASON_MAX}
          value={value}
          onChange={(event) => {
            onChange(event.target.value);
          }}
        />
      </Field>
      <div className="qp-chips" role="group" aria-label="Reason for visit">
        {REASON_CHIPS.map((chip) => (
          <button
            key={chip}
            type="button"
            className="qp-chip"
            aria-pressed={value.trim() === chip}
            onClick={() => {
              onChange(value.trim() === chip ? "" : chip);
            }}
          >
            {chip}
          </button>
        ))}
      </div>
    </div>
  );
}
