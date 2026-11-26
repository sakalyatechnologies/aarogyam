import type { Sex } from "@aarogyam/api-client";
import { Field, TextInput } from "@sakalya/ui";

import { EMPTY_PIN, PinCodeFields, useClinicPinLookup, type PinValue } from "../../components/pin-code-fields.js";

import { SEX_OPTIONS } from "../../lib/patients.js";

/** The few details a walk-in needs to be registered: name, age and sex. The rest can wait. */
export interface NewWalkIn {
  fullName: string;
  age: string;
  sex: Sex | null;
  /** Optional PIN code, city and state. */
  pin: PinValue;
}

export const EMPTY_NEW_WALK_IN: NewWalkIn = { fullName: "", age: "", sex: null, pin: EMPTY_PIN };

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
  const lookup = useClinicPinLookup();
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
        <AgeField value={value} onChange={onChange} />
      </div>
      <SexField value={value} onChange={onChange} />
      <PinCodeFields value={value.pin} lookup={lookup} onChange={(pin) => { onChange({ ...value, pin }); }} />
    </div>
  );
}

type SexAge = Pick<NewWalkIn, "age" | "sex">;

/** Age in whole years, as typed. */
export function AgeField<T extends SexAge>({ value, onChange }: { value: T; onChange: (next: T) => void }) {
  return (
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
  );
}

/** Sex as chips; pressing the chosen one again clears it. */
export function SexField<T extends SexAge>({ value, onChange }: { value: T; onChange: (next: T) => void }) {
  return (
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
  );
}
