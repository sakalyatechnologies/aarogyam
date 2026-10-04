import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { useNavigate } from "react-router";
import { z } from "zod";

import { apiErrorOf } from "@aarogyam/api-client";
import { useDocumentTitle } from "@aarogyam/app-kit";
import { Button, Card, Field, FormActions, PageHeader, PhoneInput, Select, TextInput, useToast } from "@sakalya/ui";

import { useCreateClinic } from "../../api.js";
import { RESERVED_SLUGS, SLUG_PATTERN, slugify } from "./slug.js";

const TIME_ZONES = [
  { value: "Asia/Kolkata", label: "India (Asia/Kolkata)" },
  { value: "Asia/Kathmandu", label: "Nepal (Asia/Kathmandu)" },
  { value: "Asia/Dubai", label: "UAE (Asia/Dubai)" },
] as const;

const schema = z
  .object({
    name: z.string().trim().min(2, "Enter the clinic's name.").max(80, "Keep the name under 80 characters."),
    slug: z
      .string()
      .regex(SLUG_PATTERN, "Use 3 to 30 lowercase letters, digits or single hyphens.")
      .refine((slug) => !slug.includes("--"), "Use single hyphens only.")
      .refine((slug) => !RESERVED_SLUGS.has(slug), "That address is reserved."),
    specialty: z.enum(["dental"]),
    ownerName: z.string().trim().min(2, "Enter the owner's name."),
    ownerEmail: z.union([z.literal(""), z.email("Enter a valid email address.")]),
    ownerPhone: z.union([z.literal(""), z.string().regex(/^[6-9]\d{9}$/, "Enter a 10-digit mobile number.")]),
    timezone: z.string().min(1),
  })
  .refine((values) => values.ownerEmail !== "" || values.ownerPhone !== "", {
    path: ["ownerEmail"],
    message: "Give the owner's email or mobile number.",
  });

type Values = z.input<typeof schema>;

/** API field names (snake_case paths) to form fields. */
const FIELDS: Readonly<Record<string, keyof Values>> = {
  name: "name",
  slug: "slug",
  specialty: "specialty",
  "owner.display_name": "ownerName",
  "owner.email": "ownerEmail",
  "owner.phone": "ownerPhone",
  timezone: "timezone",
};

export function NewClinicPage() {
  useDocumentTitle("New clinic", "Sakalya Console");
  const navigate = useNavigate();
  const toast = useToast();
  const create = useCreateClinic();
  const [slugEdited, setSlugEdited] = useState(false);
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    mode: "onTouched",
    defaultValues: { name: "", slug: "", specialty: "dental", ownerName: "", ownerEmail: "", ownerPhone: "", timezone: "Asia/Kolkata" },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const clinic = await create.mutateAsync({
        name: values.name.trim(),
        slug: values.slug,
        specialty: values.specialty,
        owner: {
          display_name: values.ownerName.trim(),
          ...(values.ownerEmail === "" ? {} : { email: values.ownerEmail }),
          ...(values.ownerPhone === "" ? {} : { phone: `+91${values.ownerPhone}` }),
        },
        timezone: values.timezone,
      });
      toast.show({ title: "Clinic created", description: `${clinic.slug}.aarogyam.example is ready for its owner.`, tone: "success" });
      void navigate("/clinics");
    } catch (thrown) {
      const apiError = apiErrorOf(thrown);
      const field = apiError?.field === undefined ? undefined : FIELDS[apiError.field];
      if (apiError !== undefined && field !== undefined) {
        form.setError(field, { message: apiError.message }, { shouldFocus: true });
      } else {
        form.setError("root", { message: apiError?.message ?? "Couldn't create the clinic. Please try again." });
      }
    }
  });

  const slug = useWatch({ control: form.control, name: "slug" });
  return (
    <>
      <PageHeader title="New clinic" subtitle="Creates the clinic on a trial and its portal address" />
      <Card className="max-w-2xl">
        <form noValidate onSubmit={(event) => void onSubmit(event)} className="flex flex-col gap-5">
          <Field label="Clinic name" error={errors.name?.message} required>
            <TextInput
              autoComplete="organization"
              {...form.register("name", {
                onChange: (event: { target: { value: string } }) => {
                  if (!slugEdited) {
                    form.setValue("slug", slugify(event.target.value), { shouldValidate: form.formState.isSubmitted });
                  }
                },
              })}
            />
          </Field>
          <Field
            label="Address"
            hint={`The portal will live at ${slug === "" ? "<address>" : slug}.aarogyam.example. Filled in from the name; edit it if you like.`}
            error={errors.slug?.message}
            required
          >
            <TextInput
              spellCheck={false}
              autoCapitalize="none"
              endAddon=".aarogyam.example"
              {...form.register("slug", {
                onChange: (event: { target: { value: string } }) => {
                  setSlugEdited(event.target.value !== "");
                },
              })}
            />
          </Field>
          <Field label="Specialty" error={errors.specialty?.message} required>
            <Select options={[{ value: "dental", label: "Dental" }]} {...form.register("specialty")} />
          </Field>
          <fieldset className="flex flex-col gap-4 rounded-card border border-border p-4">
            <legend className="px-1 text-sm font-bold text-text">Owner</legend>
            <Field label="Owner's name" error={errors.ownerName?.message} required>
              <TextInput autoComplete="off" {...form.register("ownerName")} />
            </Field>
            <Field label="Owner's email" hint="Email or mobile, at least one. The owner signs in with it." error={errors.ownerEmail?.message}>
              <TextInput type="email" autoComplete="off" {...form.register("ownerEmail")} />
            </Field>
            <Field label="Owner's mobile" error={errors.ownerPhone?.message}>
              <PhoneInput autoComplete="off" {...form.register("ownerPhone")} />
            </Field>
          </fieldset>
          <Field label="Time zone" error={errors.timezone?.message} required>
            <Select options={TIME_ZONES} {...form.register("timezone")} />
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
                void navigate("/clinics");
              }}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Creating…" : "Create clinic"}
            </Button>
          </FormActions>
        </form>
      </Card>
    </>
  );
}
