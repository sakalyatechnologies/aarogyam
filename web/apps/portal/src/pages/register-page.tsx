import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, ArrowRight, CheckCircle2, MailCheck } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useNavigate } from "react-router";
import { z } from "zod";

import { useDocumentTitle } from "@aarogyam/app-kit";
import { AuthHeading, AuthSteps } from "@aarogyam/auth";
import { Button, Field, Link, Select, TextArea, TextInput } from "@sakalya/ui";

import { useServices } from "../clinic.js";
import { PortalAuthShell } from "./brand.js";

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

const STEP_ONE_FIELDS = ["clinic_name", "city", "specialty"] as const satisfies readonly (keyof Values)[];
const STEP_ONE_NAMES: readonly string[] = STEP_ONE_FIELDS;
const STEPS = ["Your clinic", "About you"] as const;

/**
 * The public "Register your clinic" form: two short steps, then `POST /api/v1/registrations` and
 * a thank-you page with the one message the API always sends back, whether or not the address
 * already applied.
 */
export function RegisterPage() {
  useDocumentTitle("Register your clinic", "Aarogyam");
  const [received, setReceived] = useState<{ message: string; email: string }>();
  return (
    <PortalAuthShell>
      {received === undefined ? <RegisterForm onReceived={setReceived} /> : <ThankYou message={received.message} email={received.email} />}
    </PortalAuthShell>
  );
}

const NEXT_STEPS = [
  "We read your application and may write back with a question.",
  "Once approved, we create your clinic's own address.",
  "The owner gets an invitation by email to join with a one-time code.",
] as const;

function ThankYou({ message, email }: { message: string; email: string }) {
  const navigate = useNavigate();
  return (
    <div className="flex flex-col items-start gap-5">
      <span className="flex size-14 items-center justify-center rounded-2xl bg-success-soft text-success-text">
        <MailCheck aria-hidden="true" className="size-7" />
      </span>
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-text sm:text-3xl">Thanks for applying</h1>
        <p role="status" className="mt-2 text-sm text-muted">
          {message}
        </p>
        <p className="mt-1 text-sm text-muted">
          We'll write to <strong className="text-text">{email}</strong>. Keep an eye on your inbox, and on spam.
        </p>
      </div>
      <section aria-labelledby="next-steps" className="w-full rounded-2xl bg-surface-muted px-5 py-4">
        <h2 id="next-steps" className="mb-3 text-sm font-bold text-text">
          What happens next
        </h2>
        <ol className="m-0 flex list-none flex-col gap-3 p-0">
          {NEXT_STEPS.map((text, index) => (
            <li key={text} className="flex items-start gap-3 text-sm text-muted">
              <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-on-primary">
                {index + 1}
              </span>
              {text}
            </li>
          ))}
        </ol>
      </section>
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

function RegisterForm({ onReceived }: { onReceived: (received: { message: string; email: string }) => void }) {
  const services = useServices();
  const [step, setStep] = useState<0 | 1>(0);
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    mode: "onTouched",
    defaultValues: { clinic_name: "", city: "", specialty: "dental", contact_name: "", email: "", phone: "", message: "" },
  });
  const { errors, isSubmitting } = form.formState;

  const next = async () => {
    if (await form.trigger(STEP_ONE_FIELDS, { shouldFocus: true })) {
      setStep(1);
    }
  };

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
      onReceived({ message: result.value.message, email: values.email.trim() });
      return;
    }
    const field = result.error.field === undefined ? undefined : FIELDS[result.error.field];
    if (field !== undefined) {
      if (STEP_ONE_NAMES.includes(field)) {
        setStep(0);
      }
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
      <AuthSteps steps={STEPS} current={step} label="Registration steps" />
      <AuthHeading
        title="Register your clinic"
        subtitle={step === 0 ? "Tell us about the clinic. Two short steps, about two minutes." : "Who should we contact? We'll follow up by email to get you set up."}
      />
      <form
        noValidate
        onSubmit={(event) => {
          if (step === 0) {
            event.preventDefault();
            void next();
            return;
          }
          void onSubmit(event);
        }}
        className="flex flex-col gap-5"
      >
        <div hidden={step !== 0} className="flex flex-col gap-5">
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
        </div>
        <div hidden={step !== 1} className="flex flex-col gap-5">
          <Field label="Your name" hint="Who we should contact" error={errors.contact_name?.message} required>
            <TextInput autoComplete="name" {...form.register("contact_name")} />
          </Field>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Email" error={errors.email?.message} required>
              <TextInput type="email" autoComplete="email" autoCapitalize="none" spellCheck={false} {...form.register("email")} />
            </Field>
            <Field label="Phone" hint="Optional" error={errors.phone?.message}>
              <TextInput type="tel" autoComplete="tel" {...form.register("phone")} />
            </Field>
          </div>
          <Field label="Anything else?" hint="Optional" error={errors.message?.message}>
            <TextArea rows={3} {...form.register("message")} />
          </Field>
        </div>
        {errors.root?.message === undefined ? null : (
          <p role="alert" className="rounded-xl bg-danger-soft px-4 py-3 text-sm font-medium text-danger-text">
            {errors.root.message}
          </p>
        )}
        {step === 0 ? (
          <Button type="submit" icon={<ArrowRight aria-hidden="true" className="size-4" />}>
            Continue
          </Button>
        ) : (
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
            <Button
              variant="ghost"
              icon={<ArrowLeft aria-hidden="true" className="size-4" />}
              onClick={() => {
                setStep(0);
              }}
            >
              Back
            </Button>
            <Button type="submit" disabled={isSubmitting} icon={<CheckCircle2 aria-hidden="true" className="size-4" />}>
              {isSubmitting ? "Sending…" : "Send application"}
            </Button>
          </div>
        )}
      </form>
      <p className="mt-8 text-sm text-muted">
        Already registered?{" "}
        <Link href="/sign-in" className="font-semibold text-primary-text underline-offset-2 hover:underline">
          Sign in
        </Link>
      </p>
    </>
  );
}
