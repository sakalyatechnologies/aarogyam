import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm, useWatch } from "react-hook-form";
import { useNavigate, useParams } from "react-router";
import { z } from "zod";

import { apiErrorOf, patientId, type PatientChanges, type PatientId, type Patient, type Sex } from "@aarogyam/api-client";
import { ApiErrorNotice, useDocumentTitle } from "@aarogyam/app-kit";
import { Button, DateInput, Field, FormActions, PageHeader, PhoneInput, RadioGroup, Select, TextInput, useToast } from "@sakalya/ui";
import { MkCard, Empty } from "../../components/mk/index.js";

import { useClinic } from "../../clinic.js";
import { LANGUAGES, SEX_OPTIONS, patientPath, useTodayDate } from "../../lib/patients.js";
import { usePatient, useUpdatePatient } from "../../queries.js";
import { NotFoundPage } from "../not-found-page.js";
import { SkeletonRows } from "../../components/skeleton-rows.js";

function parseId(param: string | undefined): PatientId | undefined {
  const id = patientId.safeParse(param);
  return id.success ? id.data : undefined;
}

const schema = z
  .object({
    fullName: z.string().trim().min(2, "Enter the patient's full name.").max(120, "Keep the name under 120 characters."),
    sex: z.string().pipe(z.enum(["female", "male", "other", "unknown"], { error: "Choose the patient's sex." })),
    birthMode: z.enum(["dob", "age"]),
    dateOfBirth: z.string(),
    ageYears: z.string(),
    phone: z.union([z.literal(""), z.string().regex(/^[6-9]\d{9}$/, "Enter a 10-digit mobile number.")]),
    email: z.union([z.literal(""), z.email("Enter a valid email address.")]),
    preferredLanguage: z.string().min(1),
  })
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
  .refine((v) => v.birthMode !== "age" || (/^\d{1,3}$/.test(v.ageYears.trim()) && Number(v.ageYears) <= 130), {
    path: ["ageYears"],
    message: "Enter an age in whole years, from 0 to 130.",
    when: () => true,
  });

type Values = z.input<typeof schema>;
type Valid = z.output<typeof schema>;

const isSex = (value: string): value is Sex => SEX_OPTIONS.some((option) => option.value === value);

const FIELDS: Readonly<Record<string, keyof Values>> = {
  full_name: "fullName",
  sex: "sex",
  date_of_birth: "dateOfBirth",
  age_years: "ageYears",
  phone: "phone",
  email: "email",
  preferred_language: "preferredLanguage",
};

function defaultsFor(patient: Patient): Values {
  const estimated = patient.birth_date_estimated || patient.date_of_birth == null;
  const localPhone = patient.phone != null && patient.phone.startsWith("+91") ? patient.phone.slice(3) : "";
  return {
    fullName: patient.full_name,
    sex: patient.sex,
    birthMode: estimated ? "age" : "dob",
    dateOfBirth: estimated ? "" : (patient.date_of_birth ?? ""),
    ageYears: estimated && patient.age_years != null ? String(patient.age_years) : "",
    phone: localPhone,
    email: patient.email ?? "",
    preferredLanguage: patient.preferred_language,
  };
}

function toPatientChanges(values: Valid, canEditContact: boolean): PatientChanges {
  return {
    full_name: values.fullName.trim(),
    sex: values.sex,
    ...(values.birthMode === "dob" ? { date_of_birth: values.dateOfBirth } : { age_years: Number(values.ageYears) }),
    ...(canEditContact ? { phone: values.phone === "" ? "" : `+91${values.phone}`, email: values.email } : {}),
    preferred_language: values.preferredLanguage,
  };
}

/** Edits a patient's own details: the same rules and fields as registration. */
export function EditPatientPage() {
  const params = useParams();
  const id = parseId(params["id"]);
  const { session, can } = useClinic();
  const patient = usePatient(id);
  useDocumentTitle(patient.data === undefined ? "Edit patient" : `Edit ${patient.data.number}`, "Patients", session.clinic.name);
  if (id === undefined) {
    return <NotFoundPage title="We couldn't find that patient" />;
  }
  if (!can("patients.write")) {
    return <Empty title="You can't edit patients">Ask the clinic's owner if you need to.</Empty>;
  }
  if (patient.isPending) {
    return <SkeletonRows count={6} label="Loading the patient" />;
  }
  if (patient.isError) {
    return <ApiErrorNotice title="Couldn't open this patient" error={patient.error} onRetry={() => void patient.refetch()} />;
  }
  return <EditPatientForm id={id} patient={patient.data} canEditContact={can("patients.contact")} />;
}

function EditPatientForm({ id, patient, canEditContact }: { id: PatientId; patient: Patient; canEditContact: boolean }) {
  const navigate = useNavigate();
  const toast = useToast();
  const update = useUpdatePatient(id);
  const today = useTodayDate();
  const form = useForm<Values, unknown, Valid>({
    resolver: zodResolver(schema),
    mode: "onTouched",
    defaultValues: defaultsFor(patient),
  });
  const { errors, isSubmitting } = form.formState;
  const birthMode = useWatch({ control: form.control, name: "birthMode" });

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await update.mutateAsync(toPatientChanges(values, canEditContact));
      toast.show({ title: "Saved", tone: "success" });
      void navigate(patientPath(patient));
    } catch (thrown) {
      const apiError = apiErrorOf(thrown);
      const field = apiError?.field === undefined ? undefined : FIELDS[apiError.field];
      if (apiError !== undefined && field !== undefined) {
        form.setError(field, { message: apiError.message }, { shouldFocus: true });
      } else {
        form.setError("root", { message: apiError?.message ?? "Couldn't save the patient's details. Please try again." });
      }
    }
  });

  return (
    <>
      <PageHeader title="Edit patient" subtitle={patient.number} />
      <MkCard className="max-w-2xl">
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
          {canEditContact ? (
            <>
              <Field label="Mobile" hint="Contact only: families often share a number." error={errors.phone?.message}>
                <PhoneInput autoComplete="off" {...form.register("phone")} />
              </Field>
              <Field label="Email" error={errors.email?.message}>
                <TextInput type="email" autoComplete="off" {...form.register("email")} />
              </Field>
            </>
          ) : (
            <p className="text-sm text-muted">Phone and email need the contact permission to change; ask the clinic's owner.</p>
          )}
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
                void navigate(patientPath(patient));
              }}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Saving…" : "Save changes"}
            </Button>
          </FormActions>
        </form>
      </MkCard>
    </>
  );
}
