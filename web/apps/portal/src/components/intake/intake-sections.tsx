import type { ReactNode } from "react";

import { Checkbox, DateInput, Field, PhoneInput, Select, TextInput } from "@sakalya/ui";

import { isMasked, setWomenFlag, toggleHealth, type IntakeChoices, type IntakeProblems, type IntakeValues } from "./intake-model.js";

/** A pressable choice. The patient's own phone gets the big one. */
export function Chip({ label, on, onToggle, large }: { label: string; on: boolean; onToggle: () => void; large: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onToggle}
      className={`${large ? "min-h-12 px-5 text-base" : "min-h-9 px-3.5 text-sm"} rounded-full border border-border bg-surface font-medium text-text aria-pressed:border-primary aria-pressed:bg-primary aria-pressed:text-on-primary`}
    >
      {label}
    </button>
  );
}

function Section({ title, large, children }: { title: string; large: boolean; children: ReactNode }) {
  return (
    <details className="rounded-xl border border-border px-4 py-3">
      <summary className={`${large ? "min-h-10 text-base" : "text-sm"} cursor-pointer font-medium text-text`}>{title}</summary>
      <div className="mt-3 flex flex-col gap-4">{children}</div>
    </details>
  );
}

function Chips({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2" role="group" aria-label={label}>
      <p className="text-sm font-medium text-text">{label}</p>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

type TextKey = "occupation" | "emergencyName" | "referredBy" | "heardViaText" | "healthOther" | "allergies" | "doctorName" | "doctorAddress";
type PhoneKey = "altPhone" | "emergencyPhone" | "doctorPhone";

/**
 * The case-paper sections, collapsed so the form never feels long: personal, contact, how they found us, medical history
 * and, for a female patient, the women's questions. Every field is optional. `showHealth` is off where the checklist
 * and allergies live elsewhere (editing a patient).
 */
export function IntakeSections({
  value,
  onChange,
  choices,
  female,
  mobile,
  large = false,
  showHealth = true,
  problems = {},
}: {
  value: IntakeValues;
  onChange: (next: IntakeValues) => void;
  choices: IntakeChoices;
  female: boolean;
  /** The main mobile (ten digits), for "Same as mobile". */
  mobile: string;
  large?: boolean;
  showHealth?: boolean;
  problems?: IntakeProblems;
}) {
  const set = (patch: Partial<IntakeValues>) => {
    onChange({ ...value, ...patch });
  };
  const size = large ? "h-12 text-base" : "";
  const text = (label: string, key: TextKey, extra: { hint?: string; maxLength?: number } = {}) => (
    <Field label={label} {...(extra.hint === undefined ? {} : { hint: extra.hint })}>
      <TextInput
        className={size}
        autoComplete="off"
        maxLength={extra.maxLength ?? 120}
        value={value[key]}
        onChange={(event) => {
          set({ [key]: event.currentTarget.value });
        }}
      />
    </Field>
  );
  const phone = (label: string, key: PhoneKey) => {
    const error = problems[key];
    return (
      <Field label={label} {...(error === undefined ? {} : { error })}>
        {isMasked(value[key]) ? (
          <TextInput className={size} readOnly value={value[key]} />
        ) : (
          <PhoneInput
            className={size}
            autoComplete="off"
            value={value[key]}
            onValueChange={(digits) => {
              set({ [key]: digits });
            }}
          />
        )}
      </Field>
    );
  };
  const sameAsMobile = value.altPhone !== "" && value.altPhone === mobile;
  return (
    <div className="flex flex-col gap-3">
      <Section title="Personal details" large={large}>
        <Field label="Blood group">
          <Select
            className={size}
            options={[{ value: "", label: "Not known" }, ...choices.blood_groups.map((g) => ({ value: g.code, label: g.label }))]}
            value={value.bloodGroup}
            onChange={(event) => {
              set({ bloodGroup: event.currentTarget.value });
            }}
          />
        </Field>
        {text("Occupation", "occupation", { maxLength: 80 })}
      </Section>

      <Section title="Contact" large={large}>
        {phone("Mobile 2 / WhatsApp", "altPhone")}
        {isMasked(value.altPhone) ? null : (
          <Checkbox
            label="Same as mobile"
            checked={sameAsMobile}
            disabled={mobile === "" && !sameAsMobile}
            onChange={(event) => {
              set({ altPhone: event.currentTarget.checked ? mobile : "" });
            }}
          />
        )}
        <Field label="Best time to call">
          <Select
            className={size}
            options={[{ value: "", label: "Any time" }, ...choices.call_times.map((t) => ({ value: t.code, label: t.label }))]}
            value={value.callTime}
            onChange={(event) => {
              set({ callTime: event.currentTarget.value });
            }}
          />
        </Field>
        {text("Emergency contact name", "emergencyName")}
        {phone("Emergency contact phone", "emergencyPhone")}
      </Section>

      <Section title="How they found us" large={large}>
        {text("Referred by", "referredBy")}
        <Chips label="Heard about us from">
          {choices.heard_via.map((via) => (
            <Chip
              key={via.code}
              large={large}
              label={via.label}
              on={value.heardVia === via.code}
              onToggle={() => {
                set({ heardVia: value.heardVia === via.code ? "" : via.code });
              }}
            />
          ))}
        </Chips>
        {value.heardVia === "other" ? text("Tell us how", "heardViaText") : null}
      </Section>

      <Section title="Medical history" large={large}>
        {showHealth && choices.health_flags.length > 0 ? (
          <Chips label="Any of these?">
            {choices.health_flags.map((flag) => (
              <Chip
                key={flag.code}
                large={large}
                label={flag.label}
                on={value.health.includes(flag.code)}
                onToggle={() => {
                  onChange(toggleHealth(value, flag.code));
                }}
              />
            ))}
          </Chips>
        ) : null}
        {text("Other conditions", "healthOther", { maxLength: 300 })}
        {showHealth ? text("Drug allergies", "allergies", { hint: "Medicines or anything else, in their words.", maxLength: 200 }) : null}
        {text("Family doctor", "doctorName")}
        {phone("Family doctor's phone", "doctorPhone")}
        {text("Family doctor's address", "doctorAddress", { maxLength: 300 })}
      </Section>

      {female ? (
        <Section title="For women" large={large}>
          <Checkbox
            label="Pregnant"
            checked={value.pregnant}
            onChange={(event) => {
              onChange(setWomenFlag(value, "pregnant", event.currentTarget.checked, showHealth));
            }}
          />
          {value.pregnant ? (
            <Field label="Due date">
              <DateInput
                className={size}
                value={value.dueDate}
                onChange={(event) => {
                  set({ dueDate: event.currentTarget.value });
                }}
              />
            </Field>
          ) : null}
          <Checkbox
            label="Nursing"
            checked={value.nursing}
            onChange={(event) => {
              onChange(setWomenFlag(value, "nursing", event.currentTarget.checked, showHealth));
            }}
          />
        </Section>
      ) : null}
    </div>
  );
}
