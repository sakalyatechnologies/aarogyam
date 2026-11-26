import type { ComponentProps } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useController, useForm, useWatch, type UseFormReturn } from "react-hook-form";
import { z } from "zod";

import { apiErrorOf, type NewPatient, type Sex } from "@aarogyam/api-client";
import { Field, PhoneInput, RadioGroup, Select, TextInput } from "@sakalya/ui";

import { DobInput } from "../../components/dob-input.js";
import { PinCodeFields, useClinicPinLookup, type PinValue } from "../../components/pin-code-fields.js";
import { LANGUAGES, SEX_OPTIONS } from "../../lib/patients.js";

/** The registration form's rules, shared by the New patient page and the booking dialog. */
export const patientSchema = z
  .object({
    fullName: z.string().trim().min(2, "Enter the patient's full name.").max(120, "Keep the name under 120 characters."),
    // A string while editing (nothing chosen is ""), the closed set once valid.
    sex: z.string().pipe(z.enum(["female", "male", "other", "unknown"], { error: "Choose the patient's sex." })),
    birthMode: z.enum(["dob", "age"]),
    dateOfBirth: z.string(),
    ageYears: z.string(),
    phone: z.union([z.literal(""), z.string().regex(/^[6-9]\d{9}$/, "Enter a 10-digit mobile number.")]),
    email: z.union([z.literal(""), z.email("Enter a valid email address.")]),
    preferredLanguage: z.string().min(1),
  })
  // `when` runs these even while other fields are wrong, so every problem shows at once.
  .refine((v) => v.birthMode !== "dob" || v.dateOfBirth !== "", {
    path: ["dateOfBirth"],
    message: "Enter the date of birth, or give an age instead.",
    when: () => true,
  })
  .refine((v) => v.birthMode !== "dob" || v.dateOfBirth === "" || v.dateOfBirth <= new Date().toISOString().slice(0, 10), {
    path: ["dateOfBirth"],
    message: "The date of birth can't be in the future.",
    when: () => true,
  })
  .refine((v) => v.birthMode !== "age" || /^\d{1,3}$/.test(v.ageYears.trim()) && Number(v.ageYears) <= 130, {
    path: ["ageYears"],
    message: "Enter an age in whole years, from 0 to 130.",
    when: () => true,
  });

export type PatientValues = z.input<typeof patientSchema>;
export type ValidPatient = z.output<typeof patientSchema>;
export type PatientForm = UseFormReturn<PatientValues, unknown, ValidPatient>;

export const EMPTY_PATIENT: PatientValues = { fullName: "", sex: "", birthMode: "dob", dateOfBirth: "", ageYears: "", phone: "", email: "", preferredLanguage: "en-IN" };

const isSex = (value: string): value is Sex => SEX_OPTIONS.some((option) => option.value === value);

/** API fields (snake_case) to form fields, so the API's field errors show where they belong. */
const FIELDS: Readonly<Record<string, keyof PatientValues>> = {
  full_name: "fullName",
  sex: "sex",
  date_of_birth: "dateOfBirth",
  age_years: "ageYears",
  phone: "phone",
  email: "email",
  preferred_language: "preferredLanguage",
};

export function toNewPatient(values: ValidPatient): NewPatient {
  return {
    full_name: values.fullName.trim(),
    sex: values.sex,
    ...(values.birthMode === "dob" ? { date_of_birth: values.dateOfBirth } : { age_years: Number(values.ageYears) }),
    ...(values.phone === "" ? {} : { phone: `+91${values.phone}` }),
    ...(values.email === "" ? {} : { email: values.email }),
    preferred_language: values.preferredLanguage,
  };
}

/** The registration form: errors show once a field is left, and every field is checked on submit. */
export function usePatientForm(): PatientForm {
  return useForm<PatientValues, unknown, ValidPatient>({ resolver: zodResolver(patientSchema), mode: "onTouched", defaultValues: EMPTY_PATIENT });
}

/**
 * Puts a failed registration's API error on its field. Returns the message to show for the whole form
 * when the error belongs to no field.
 */
export function patientErrorOf(form: PatientForm, thrown: unknown): string | undefined {
  const apiError = apiErrorOf(thrown);
  const field = apiError?.field === undefined ? undefined : FIELDS[apiError.field];
  if (apiError !== undefined && field !== undefined) {
    form.setError(field, { message: apiError.message }, { shouldFocus: true });
    return undefined;
  }
  return apiError?.message ?? "Couldn't register the patient. Please try again.";
}

/** The date-of-birth box, wired to the form (kept as ISO). A direct child of its Field, so the label reaches the input. */
function DobController({ of, ...rest }: { of: PatientForm } & Omit<ComponentProps<typeof DobInput>, "value" | "onValueChange">) {
  const { field } = useController({ control: of.control, name: "dateOfBirth" });
  return <DobInput {...rest} name={field.name} value={field.value} onValueChange={field.onChange} onBlur={field.onBlur} />;
}

/** The preferred-language choice, shown in the Contact section (English unless changed). */
export function LanguageField({ form }: { form: PatientForm }) {
  return (
    <Field label="Preferred language" error={form.formState.errors.preferredLanguage?.message}>
      <Select options={LANGUAGES} {...form.register("preferredLanguage")} />
    </Field>
  );
}

/** The registration fields: name, mobile, sex, date of birth or age, email and address (PIN first). */
export function PatientFields({ form, address }: { form: PatientForm; address?: { line1: string; pin: PinValue; onChange: (next: { line1: string; pin: PinValue }) => void } }) {
  const lookup = useClinicPinLookup();
  const { errors } = form.formState;
  const birthMode = useWatch({ control: form.control, name: "birthMode" });
  return (
    <>
      <Field label="Full name" error={errors.fullName?.message} required>
        <TextInput autoComplete="off" {...form.register("fullName")} />
      </Field>
      <Field label="Mobile" hint="Contact only: families often share a number." error={errors.phone?.message}>
        <PhoneInput autoComplete="off" {...form.register("phone")} />
      </Field>
      <Controller
        control={form.control}
        name="sex"
        render={({ field }) => (
          <RadioGroup
            label="Sex"
            name={field.name}
            options={SEX_OPTIONS}
            value={isSex(field.value) ? field.value : null}
            onValueChange={field.onChange}
            error={errors.sex?.message}
            orientation="horizontal"
            required
          />
        )}
      />
      <Controller
        control={form.control}
        name="birthMode"
        render={({ field }) => (
          <RadioGroup
            label="Age"
            name={field.name}
            options={[
              { value: "dob", label: "Date of birth" },
              { value: "age", label: "Age only", hint: "When the date isn't known" },
            ]}
            value={field.value}
            onValueChange={field.onChange}
            orientation="horizontal"
          />
        )}
      />
      {birthMode === "dob" ? (
        <Field label="Date of birth" hint="Day, month, year." error={errors.dateOfBirth?.message} required>
          <DobController of={form} />
        </Field>
      ) : (
        <Field label="Age in years" hint="An estimate is fine." error={errors.ageYears?.message} required>
          <TextInput inputMode="numeric" autoComplete="off" className="max-w-32" {...form.register("ageYears")} />
        </Field>
      )}
      <Field label="Email" error={errors.email?.message}>
        <TextInput type="email" autoComplete="off" {...form.register("email")} />
      </Field>
      {address === undefined ? null : (
        <>
          <PinCodeFields compact value={address.pin} lookup={lookup} onChange={(pin) => { address.onChange({ line1: address.line1, pin }); }} />
          <Field label="Address" hint="House, building and street.">
            <TextInput autoComplete="off" value={address.line1} onChange={(event) => { address.onChange({ line1: event.currentTarget.value, pin: address.pin }); }} />
          </Field>
        </>
      )}
    </>
  );
}
