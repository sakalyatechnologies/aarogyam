import { zodResolver } from "@hookform/resolvers/zod";
import { Copy } from "lucide-react";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { useNavigate } from "react-router";
import { z } from "zod";

import { apiErrorOf, type CreatedClinic } from "@aarogyam/api-client";
import { formatDateTime, useDocumentTitle } from "@aarogyam/app-kit";
import { Button, Card, Field, FormActions, PageHeader, Select, TextInput, useToast } from "@sakalya/ui";

import { useCreateClinic } from "../../api.js";
import { HOST_AFFIXES, RESERVED_SLUGS, SLUG_PATTERN, portalHost, slugify } from "./slug.js";

const schema = z.object({
  name: z.string().trim().min(2, "Enter the clinic's name.").max(80, "Keep the name under 80 characters."),
  slug: z
    .string()
    .regex(SLUG_PATTERN, "Use 3 to 30 lowercase letters, digits or single hyphens.")
    .refine((slug) => !slug.includes("--"), "Use single hyphens only.")
    .refine((slug) => !RESERVED_SLUGS.has(slug), "That address is reserved."),
  specialty: z.enum(["dental"]),
  ownerEmail: z.email("Enter the owner's email address."),
});

type Values = z.input<typeof schema>;

/** API field names to form fields. A taken address comes back as a 409 with no field. */
const FIELDS: Readonly<Record<string, keyof Values>> = { name: "name", slug: "slug", specialty: "specialty", owner_email: "ownerEmail" };

/** The owner's invitation. The token rides in the fragment, which browsers never send to a server. */
export function inviteLink(created: CreatedClinic): string {
  const port = import.meta.env.VITE_PORTAL_PORT ?? (import.meta.env.DEV ? "5173" : "");
  return `${window.location.protocol}//${created.portal_host}${port === "" ? "" : `:${port}`}/invite#${created.invite_token}`;
}

export function NewClinicPage() {
  useDocumentTitle("New clinic", "Sakalya Console");
  const [created, setCreated] = useState<CreatedClinic>();
  return created === undefined ? <NewClinicForm onCreated={setCreated} /> : <InvitePanel created={created} />;
}

function InvitePanel({ created }: { created: CreatedClinic }) {
  const navigate = useNavigate();
  const toast = useToast();
  const link = inviteLink(created);
  return (
    <>
      <PageHeader title="Clinic created" subtitle={`${created.portal_host} is being set up for its owner, usually within two minutes (the clinic's page shows when its address is ready).`} />
      <Card className="max-w-2xl">
        <h2 className="text-lg font-bold text-text">Send the owner this invitation</h2>
        <p className="mt-1 text-sm text-muted">
          It works once, for the email you entered, until {formatDateTime(created.invite_expires_at)}. Share it privately: anyone with the link can
          try to use it.
        </p>
        <Field label="Invitation link" className="mt-4">
          <TextInput readOnly value={link} className="font-mono" onFocus={(event) => { event.currentTarget.select(); }} />
        </Field>
        <FormActions className="mt-4">
          <Button
            variant="secondary"
            onClick={() => {
              void navigate("/clinics");
            }}
          >
            Back to clinics
          </Button>
          <Button
            icon={<Copy aria-hidden="true" className="size-4" />}
            onClick={() => {
              void navigator.clipboard.writeText(link).then(
                () => toast.show({ title: "Invitation link copied", tone: "success" }),
                () => toast.show({ title: "Couldn't copy; select the link and copy it", tone: "warning" }),
              );
            }}
          >
            Copy link
          </Button>
        </FormActions>
      </Card>
    </>
  );
}

function NewClinicForm({ onCreated }: { onCreated: (created: CreatedClinic) => void }) {
  const navigate = useNavigate();
  const create = useCreateClinic();
  const [slugEdited, setSlugEdited] = useState(false);
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    mode: "onTouched",
    defaultValues: { name: "", slug: "", specialty: "dental", ownerEmail: "" },
  });
  const { errors, isSubmitting } = form.formState;
  const slug = useWatch({ control: form.control, name: "slug" });

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      onCreated(await create.mutateAsync({ name: values.name.trim(), slug: values.slug, specialty: values.specialty, owner_email: values.ownerEmail }));
    } catch (thrown) {
      const apiError = apiErrorOf(thrown);
      const field = apiError?.status === 409 ? "slug" : apiError?.field === undefined ? undefined : FIELDS[apiError.field];
      if (apiError !== undefined && field !== undefined) {
        const message = apiError.status === 409 ? "That address is already taken." : apiError.message;
        form.setError(field, { message }, { shouldFocus: true });
      } else {
        form.setError("root", { message: apiError?.message ?? "Couldn't create the clinic. Please try again." });
      }
    }
  });

  return (
    <>
      <PageHeader title="New clinic" subtitle="Creates the clinic on a trial, its portal address and the owner's invitation" />
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
            hint={`The portal will live at ${portalHost(slug === "" ? "<address>" : slug)}. Filled in from the name; edit it if you like.`}
            error={errors.slug?.message}
            required
          >
            <TextInput
              spellCheck={false}
              autoCapitalize="none"
              {...(HOST_AFFIXES[0] === "" ? {} : { startAddon: HOST_AFFIXES[0] })}
              endAddon={HOST_AFFIXES[1]}
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
          <Field label="Owner's email" hint="The owner accepts the invitation with this email." error={errors.ownerEmail?.message} required>
            <TextInput type="email" autoComplete="off" {...form.register("ownerEmail")} />
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
