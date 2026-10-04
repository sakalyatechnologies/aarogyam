import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm, useWatch } from "react-hook-form";
import { useNavigate } from "react-router";
import { z } from "zod";

import { apiErrorOf, type NewPatient, type Sex } from "@aarogyam/api-client";
import { useDocumentTitle } from "@aarogyam/app-kit";
import { Button, Card, DateInput, EmptyState, Field, FormActions, PageHeader, PhoneInput, RadioGroup, Select, TextInput, useToast } from "@sakalya/ui";

import { useClinic } from "../../clinic.js";
import { LANGUAGES, SEX_OPTIONS, patientPath, useTodayDate } from "../../lib/patients.js";
import { useCreatePatient } from "../../queries.js";

const schema = z
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

type Values = z.input<typeof schema>;

const isSex = (value: string): value is Sex => SEX_OPTIONS.some((option) => option.value === value);
type Valid = z.output<typeof schema>;

/** API fields (snake_case) to form fields, so the API's field errors show where they belong. */
const FIELDS: Readonly<Record<string, keyof Values>> = {
  full_name: "fullName",
  sex: "sex",
  date_of_birth: "dateOfBirth",
  age_years: "ageYears",
  phone: "phone",
  email: "email",
  preferred_language: "preferredLanguage",
};

export function toNewPatient(values: Valid): NewPatient {
  return {
    full_name: values.fullName.trim(),
    sex: values.sex,
    ...(values.birthMode === "dob" ? { date_of_birth: values.dateOfBirth } : { age_years: Number(values.ageYears) }),
    ...(values.phone === "" ? {} : { phone: `+91${values.phone}` }),
    ...(values.email === "" ? {} : { email: values.email }),
    preferred_language: values.preferredLanguage,
  };
}

export function NewPatientPage() {
  const { session, can } = useClinic();
  useDocumentTitle("New patient", session.clinic.name);
  if (!can("patients.write")) {
    return <EmptyState title="You can't register patients" description="Ask the clinic's owner if you need to." />;
  }
  return <NewPatientForm />;
}

function NewPatientForm() {
  const navigate = useNavigate();
  const toast = useToast();
  const create = useCreatePatient();
  const today = useTodayDate();
  const form = useForm<Values, unknown, Valid>({
    resolver: zodResolver(schema),
    mode: "onTouched",
    defaultValues: { fullName: "", sex: "", birthMode: "dob", dateOfBirth: "", ageYears: "", phone: "", email: "", preferredLanguage: "en-IN" },
  });
  const { errors, isSubmitting } = form.formState;
  const birthMode = useWatch({ control: form.control, name: "birthMode" });

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const patient = await create.mutateAsync(toNewPatient(values));
      toast.show({ title: `Registered ${patient.number}`, tone: "success" });
      void navigate(patientPath(patient));
    } catch (thrown) {
      const apiError = apiErrorOf(thrown);
      const field = apiError?.field === undefined ? undefined : FIELDS[apiError.field];
      if (apiError !== undefined && field !== undefined) {
        form.setError(field, { message: apiError.message }, { shouldFocus: true });
      } else {
        form.setError("root", { message: apiError?.message ?? "Couldn't register the patient. Please try again." });
      }
    }
  });

  return (
    <>
      <PageHeader title="New patient" subtitle="The clinic number is given when you save." />
      <Card className="max-w-2xl">
        <form noValidate onSubmit={(event) => void onSubmit(event)} className="flex flex-col gap-5">
          <Field label="Full name" error={errors.fullName?.message} required>
            <TextInput autoComplete="off" {...form.register("fullName")} />
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
            <Field label="Date of birth" error={errors.dateOfBirth?.message} required>
              <DateInput {...form.register("dateOfBirth")} max={today} min="1896-01-01" />
            </Field>
          ) : (
            <Field label="Age in years" hint="An estimate is fine." error={errors.ageYears?.message} required>
              <TextInput inputMode="numeric" autoComplete="off" className="max-w-32" {...form.register("ageYears")} />
            </Field>
          )}
          <Field label="Mobile" hint="Contact only: families often share a number." error={errors.phone?.message}>
            <PhoneInput autoComplete="off" {...form.register("phone")} />
          </Field>
          <Field label="Email" error={errors.email?.message}>
            <TextInput type="email" autoComplete="off" {...form.register("email")} />
          </Field>
          <Field label="Preferred language" error={errors.preferredLanguage?.message} required>
            <Select options={LANGUAGES} {...form.register("preferredLanguage")} />
          </Field>
          {errors.root?.message === undefined ? null : (
            <p role="alert" className="rounded-xl bg-danger-soft px-4 py-3 text-sm font-medium text-danger-text">
              {errors.root.message}
            </p>
          )}
          <FormActions>
            <Button
              variant="secondary"
              onClick={() => {
                void navigate("/patients");
              }}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Saving…" : "Register patient"}
            </Button>
          </FormActions>
        </form>
      </Card>
    </>
  );
}
