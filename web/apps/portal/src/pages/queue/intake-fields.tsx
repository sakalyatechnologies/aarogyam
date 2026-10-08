import { Check } from "lucide-react";

import { useQuickPicks } from "../../walk-in-queries.js";

/** What the patient tells the desk: allergies (or none known) and the consents they give aloud. */
export interface Intake {
  allergies: readonly string[];
  noKnownAllergies: boolean;
  reminders: boolean;
}

export const EMPTY_INTAKE: Intake = { allergies: [], noKnownAllergies: false, reminders: true };

export function IntakeFields({ value, onChange }: { value: Intake; onChange: (next: Intake) => void }) {
  const picks = useQuickPicks();
  const common = picks.data?.allergies ?? [];
  const toggle = (label: string) => {
    const has = value.allergies.includes(label);
    onChange({ ...value, noKnownAllergies: false, allergies: has ? value.allergies.filter((a) => a !== label) : [...value.allergies, label] });
  };
  return (
    <>
      <div className="wi-section">
        <div>
          <p className="qp-label">Allergies</p>
          <div className="qp-chips" role="group" aria-label="Allergies">
            <button
              type="button"
              className="qp-chip qp-none"
              aria-pressed={value.noKnownAllergies}
              onClick={() => {
                onChange({ ...value, allergies: [], noKnownAllergies: !value.noKnownAllergies });
              }}
            >
              {value.noKnownAllergies ? <Check aria-hidden="true" /> : null}
              No known allergies
            </button>
            {common.map((pick) => (
              <button key={pick.id} type="button" className="qp-chip" aria-pressed={value.allergies.includes(pick.label)} onClick={() => { toggle(pick.label); }}>
                {pick.label}
              </button>
            ))}
          </div>
          <p className="qp-hint">Recorded as patient-reported. The doctor confirms them at the visit.</p>
        </div>
      </div>
      <div className="wi-section">
        <p className="qp-label">Consent</p>
        <p className="wi-read">
          Read aloud: “The clinic keeps your health record to treat you, and may remind you about visits by SMS or WhatsApp. You can withdraw this any time.”
        </p>
        <label className="wi-check">
          <input type="checkbox" checked disabled readOnly />
          Agrees to treatment and keeping their record
        </label>
        <label className="wi-check">
          <input
            type="checkbox"
            checked={value.reminders}
            onChange={(event) => {
              onChange({ ...value, reminders: event.target.checked });
            }}
          />
          Agrees to visit reminders
        </label>
      </div>
    </>
  );
}
