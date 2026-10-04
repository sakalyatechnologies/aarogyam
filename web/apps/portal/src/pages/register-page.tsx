import { zodResolver } from "@hookform/resolvers/zod";
import { HeartPulse, MailCheck } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useNavigate } from "react-router";
import { z } from "zod";

import { useDocumentTitle } from "@aarogyam/app-kit";
import { Button, Card, Field, FormActions, Select, TextArea, TextInput } from "@sakalya/ui";

import { useServices } from "../clinic.js";

const schema = z.object({
  clinic_name: z.string().trim().min(2, "Enter the clinic's name.").max(200, "Keep it under 200 characters."),
  city: z.string().trim().min(2, "Enter the clinic's city.").max(100, "Keep it under 100 characters."),
  specialty: z.enum(["dental", "general"]),
  contact_name: z.string().trim().min(2, "Enter a contact name.").max(200, "Keep it under 200 characters."),
  email: z.email("Enter a valid email address."),
  phone: z.string().trim().max(20, "Keep it under 20 characters.").optional(),
  message: z.string().trim().max(2000, "Keep it under 2,000 characters.").optional(),
});

type Values = z.input<typeof schema>;

const FIELDS: Readonly<Record<string, keyof Values>> = {
  clinic_name: "clinic_name",
  city: "city",
  specialty: "specialty",
  contact_name: "contact_name",
  email: "email",
  phone: "phone",
  message: "message",
};

/**
 * The public "Register your clinic" form: `POST /api/v1/registrations`, then a thank-you screen
 * with the one message the API always sends back, whether or not the address already applied.
 */
export function RegisterPage() {
  useDocumentTitle("Register your clinic", "Aarogyam");
  const [received, setReceived] = useState<string>();
  return (
    <main className="flex min-h-full items-center justify-center px-4 py-10">
      <div className="w-full max-w-xl">
        <div className="flex items-center gap-3">
          <span className="flex size-11 items-center justify-center rounded-2xl bg-primary text-on-primary">
            <HeartPulse aria-hidden="true" className="size-6" />
          </span>
          <div className="leading-tight">
            <p className="text-lg font-extrabold tracking-tight text-text">Aarogyam</p>
            <p className="text-xs text-muted">Ārogyaṁ dhana sampadā</p>
          </div>
        </div>
        <Card className="mt-6">{received === undefined ? <RegisterForm onReceived={setReceived} /> : <ThankYou message={received} />}</Card>
      </div>
    </main>
  );
}

function ThankYou({ message }: { message: string }) {
  const navigate = useNavigate();
  return (
    <div className="flex flex-col items-start gap-4">
      <span className="flex size-11 items-center justify-center rounded-2xl bg-success-soft text-success-text">
        <MailCheck aria-hidden="true" className="size-6" />
      </span>
      <div>
        <h1 className="mb-1 text-2xl font-extrabold tracking-tight text-text">Thanks for applying</h1>
        <p className="text-sm text-muted">{message}</p>
      </div>
      <Button
        variant="secondary"
        onClick={() => {
          void navigate("/", { replace: true });
        }}
      >
        Back to Aarogyam
      </Button>
    </div>
  );
}

function RegisterForm({ onReceived }: { onReceived: (message: string) => void }) {
  const services = useServices();
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    mode: "onTouched",
    defaultValues: { clinic_name: "", city: "", specialty: "dental", contact_name: "", email: "", phone: "", message: "" },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    const result = await services.neutral.submitRegistration({
      clinic_name: values.clinic_name.trim(),
      city: values.city.trim(),
      specialty: values.specialty,
      contact_name: values.contact_name.trim(),
      email: values.email.trim(),
      phone: values.phone?.trim() === "" ? null : (values.phone?.trim() ?? null),
      message: values.message?.trim() === "" ? null : (values.message?.trim() ?? null),
    });
    if (result.ok) {
      onReceived(result.value.message);
      return;
    }
    const field = result.error.field === undefined ? undefined : FIELDS[result.error.field];
    if (field !== undefined) {
      form.setError(field, { message: result.error.message }, { shouldFocus: true });
    } else {
      form.setError("root", {
        message:
          result.error.status === 429
            ? "Too many applications from this address. Please try again in a while."
            : result.error.message,
      });
    }
  });

  return (
    <>
      <h1 className="mb-1 text-2xl font-extrabold tracking-tight text-text">Register your clinic</h1>
      <p className="mb-5 text-sm text-muted">Tell us a little about your clinic. We'll follow up by email to get you set up.</p>
      <form noValidate onSubmit={(event) => void onSubmit(event)} className="flex flex-col gap-5">
        <Field label="Clinic name" error={errors.clinic_name?.message} required>
          <TextInput autoComplete="organization" {...form.register("clinic_name")} />
        </Field>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="City" error={errors.city?.message} required>
            <TextInput autoComplete="address-level2" {...form.register("city")} />
          </Field>
          <Field label="Specialty" error={errors.specialty?.message} required>
            <Select
              options={[
                { value: "dental", label: "Dental" },
                { value: "general", label: "General practice" },
              ]}
              {...form.register("specialty")}
            />
          </Field>
        </div>
        <Field label="Your name" hint="Who we should contact" error={errors.contact_name?.message} required>
          <TextInput autoComplete="name" {...form.register("contact_name")} />
        </Field>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Email" error={errors.email?.message} required>
            <TextInput type="email" autoComplete="email" {...form.register("email")} />
          </Field>
          <Field label="Phone" hint="Optional" error={errors.phone?.message}>
            <TextInput type="tel" autoComplete="tel" {...form.register("phone")} />
          </Field>
        </div>
        <Field label="Anything else?" hint="Optional" error={errors.message?.message}>
          <TextArea rows={3} {...form.register("message")} />
        </Field>
        {errors.root?.message === undefined ? null : (
          <p role="alert" className="rounded-xl bg-danger-soft px-4 py-3 text-sm font-medium text-danger-text">
            {errors.root.message}
          </p>
        )}
        <FormActions>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Sending…" : "Send application"}
          </Button>
        </FormActions>
      </form>
    </>
  );
}
