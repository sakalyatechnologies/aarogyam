import type { Sex } from "@aarogyam/api-client";
import { Field, TextInput } from "@sakalya/ui";

import { SEX_OPTIONS } from "../../lib/patients.js";

/** The few details a walk-in needs to be registered: name, age and sex. The rest can wait. */
export interface NewWalkIn {
  fullName: string;
  age: string;
  sex: Sex | null;
}

export const EMPTY_NEW_WALK_IN: NewWalkIn = { fullName: "", age: "", sex: null };

/** The name is required; an age, when given, is a whole number from 0 to 120. */
export function newWalkInProblem(value: NewWalkIn): string | undefined {
  if (value.fullName.trim().length < 2) {
    return "Enter the patient's name.";
  }
  if (value.age !== "" && !/^\d{1,3}$/.test(value.age)) {
    return "Age is a number of years.";
  }
  if (value.age !== "" && Number(value.age) > 120) {
    return "Age is a number of years.";
  }
  return undefined;
}

export function NewWalkInFields({ value, onChange }: { value: NewWalkIn; onChange: (next: NewWalkIn) => void }) {
  return (
    <div className="wi-section">
      <div className="wi-grid">
        <Field label="Name" required>
          <TextInput
            autoComplete="off"
            value={value.fullName}
            onChange={(event) => {
              onChange({ ...value, fullName: event.target.value });
            }}
          />
        </Field>
        <Field label="Age" hint="Years">
          <TextInput
            inputMode="numeric"
            autoComplete="off"
            value={value.age}
            onChange={(event) => {
              onChange({ ...value, age: event.target.value.replace(/\D/g, "").slice(0, 3) });
            }}
          />
        </Field>
      </div>
      <div>
        <p className="qp-label">Sex</p>
        <div className="qp-chips" role="group" aria-label="Sex">
          {SEX_OPTIONS.filter((option) => option.value !== "unknown").map((option) => (
            <button
              key={option.value}
              type="button"
              className="qp-chip"
              aria-pressed={value.sex === option.value}
              onClick={() => {
                onChange({ ...value, sex: value.sex === option.value ? null : option.value });
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
