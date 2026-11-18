import { FileImage, Paperclip, Plus } from "lucide-react";
import { useRef, useState } from "react";

import { apiErrorOf, attachmentId, type AttachmentId, type Consent, type ConsentMethod, type ConsentPurpose, type PatientId } from "@aarogyam/api-client";
import { ApiErrorNotice, formatDate } from "@aarogyam/app-kit";
import { Button, Dialog, Field, Select, TextArea, TextInput, useFieldControl, useToast } from "@sakalya/ui";

import { Empty, MkCard, Tag, statusTone } from "../../components/mk/index.js";
import { SkeletonRows } from "../../components/skeleton-rows.js";
import { useClinic } from "../../clinic.js";
import { useDownloadLink, useUploadAttachment } from "../../queries.js";
import { useConsents, useRecordConsent, useSetConsentSignature, useWithdrawConsent } from "./queries.js";

export const PURPOSES: readonly { value: ConsentPurpose; label: string; help: string }[] = [
  { value: "care", label: "Care and records", help: "Keeping their record and treating them." },
  { value: "reminders", label: "Reminders", help: "Appointment and recall messages by SMS, WhatsApp or email." },
  { value: "promotional", label: "Offers", help: "Promotional messages." },
  { value: "sharing", label: "Sharing", help: "Sharing records with another clinic or doctor they name." },
  { value: "research", label: "Research", help: "De-identified use for research or teaching." },
];

const METHODS: readonly { value: ConsentMethod; label: string }[] = [
  { value: "paper", label: "Paper form" },
  { value: "verbal", label: "Said aloud, noted by staff" },
  { value: "app", label: "In an app" },
];

/** What a photo or scan of the signed form may be; the server takes the same, up to 10 MB. */
const FORM_TYPES = "image/jpeg,image/png,application/pdf";
const FORM_MAX_BYTES = 10 * 1024 * 1024;

/** Why this file can't be the signed form, or nothing. */
function formProblem(file: File): string | undefined {
  if (!FORM_TYPES.split(",").includes(file.type)) return "Choose a photo (JPEG or PNG) or a PDF.";
  if (file.size > FORM_MAX_BYTES) return "That file is over 10 MB. Take the photo again at a smaller size.";
  return undefined;
}

/** Uploads the signed form as a patient file of kind `consent`; resolves to its id. */
function useUploadForm(patientId: PatientId) {
  const upload = useUploadAttachment(patientId);
  return {
    isPending: upload.isPending,
    upload: async (file: File): Promise<AttachmentId> => {
      const form = new FormData();
      form.append("kind", "consent");
      form.append("caption", "Signed consent form");
      form.append("file", file);
      const saved = await upload.mutateAsync(form);
      return saved.id;
    },
  };
}

const purposeLabel = (purpose: ConsentPurpose) => PURPOSES.find((p) => p.value === purpose)?.label ?? purpose;
const methodLabel = (method: ConsentMethod) => METHODS.find((m) => m.value === method)?.label ?? method;

/** The patient's consent records: what they agreed to, which notice they saw, when and how, and any withdrawal. */
export function ConsentPanel({ patientId }: { patientId: PatientId }) {
  const { can } = useClinic();
  const consents = useConsents(patientId);
  const [recording, setRecording] = useState(false);
  const [withdrawing, setWithdrawing] = useState<Consent | undefined>(undefined);
  const canWrite = can("patients.write");

  if (consents.isPending) {
    return <SkeletonRows count={3} label="Loading consent records" />;
  }
  if (consents.isError) {
    return <ApiErrorNotice title="Couldn't load consent records" error={consents.error} onRetry={() => void consents.refetch()} />;
  }
  const items = consents.data.items;
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted">
        Record that the patient was shown the clinic's privacy notice and agreed, and when they withdraw. This is the clinic's own record under the DPDP Act.
      </p>
      {items.length === 0 ? (
        <Empty title="No consent recorded yet">When the patient has seen the notice and agreed, record it here.</Empty>
      ) : (
        <ul className="flex flex-col gap-3" aria-label="Consent records">
          {items.map((c) => (
            <li key={c.id}>
              <MkCard>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-base font-bold text-text">{purposeLabel(c.purpose)}</h3>
                  <Tag tone={statusTone(c.status === "given" ? "success" : "neutral")}>{c.status === "given" ? "Given" : "Withdrawn"}</Tag>
                  {canWrite && c.status === "given" ? (
                    <Button
                      variant="ghost"
                      className="ml-auto px-2 py-1"
                      aria-label={`Withdraw consent: ${purposeLabel(c.purpose)}`}
                      onClick={() => {
                        setWithdrawing(c);
                      }}
                    >
                      Withdraw
                    </Button>
                  ) : null}
                </div>
                <p className="mt-1 text-sm text-muted">
                  Notice {c.notice_version} · {methodLabel(c.method)} · {formatDate(c.given_at)} · recorded by {c.recorded_by}
                </p>
                {c.note == null ? null : <p className="mt-1 text-sm text-text">{c.note}</p>}
                <SignedForm patientId={patientId} consent={c} canWrite={canWrite} />
                {c.status === "withdrawn" && c.withdrawn_at != null ? (
                  <p className="mt-1 text-sm text-muted">
                    Withdrawn {formatDate(c.withdrawn_at)}
                    {c.withdrawn_method == null ? "" : ` · ${methodLabel(c.withdrawn_method)}`}
                    {c.withdrawn_by == null ? "" : ` · recorded by ${c.withdrawn_by}`}
                    {c.withdrawal_note == null ? "" : ` · ${c.withdrawal_note}`}
                  </p>
                ) : null}
              </MkCard>
            </li>
          ))}
        </ul>
      )}
      {canWrite ? (
        <div>
          <Button
            variant="secondary"
            icon={<Plus aria-hidden="true" className="size-4" />}
            onClick={() => {
              setRecording(true);
            }}
          >
            Record consent
          </Button>
        </div>
      ) : null}
      {recording ? (
        <RecordConsentDialog
          patientId={patientId}
          active={items.filter((c) => c.status === "given").map((c) => c.purpose)}
          onOpenChange={() => {
            setRecording(false);
          }}
        />
      ) : null}
      {withdrawing === undefined ? null : (
        <WithdrawDialog
          key={withdrawing.id}
          patientId={patientId}
          consent={withdrawing}
          onOpenChange={() => {
            setWithdrawing(undefined);
          }}
        />
      )}
    </div>
  );
}

/** The signed form on a consent: open it, or (while given) attach a photo or scan of it. */
function SignedForm({ patientId, consent, canWrite }: { patientId: PatientId; consent: Consent; canWrite: boolean }) {
  const link = useDownloadLink();
  const form = useUploadForm(patientId);
  const attach = useSetConsentSignature(patientId);
  const input = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const signature = consent.signature_attachment_id;
  if (signature != null) {
    return (
      <Button
        variant="ghost"
        className="mt-1 px-2 py-1"
        icon={<FileImage aria-hidden="true" className="size-4" />}
        disabled={link.isPending}
        aria-label={`View signed form: ${purposeLabel(consent.purpose)}`}
        onClick={() => {
          link.mutate(attachmentId.parse(signature), {
            onSuccess: (opened) => {
              window.open(opened.url, "_blank", "noopener,noreferrer");
            },
            onError: (thrown) => {
              toast.show({ title: apiErrorOf(thrown)?.message ?? "Couldn't open the signed form.", tone: "danger" });
            },
          });
        }}
      >
        View signed form
      </Button>
    );
  }
  if (!canWrite || consent.status !== "given") return null;
  const busy = form.isPending || attach.isPending;
  const onFile = async (file: File) => {
    const problem = formProblem(file);
    if (problem !== undefined) {
      toast.show({ title: problem, tone: "danger" });
      return;
    }
    try {
      const id = await form.upload(file);
      await attach.mutateAsync({ id: consent.id, input: { signature_attachment_id: id } });
      toast.show({ title: "Signed form added", tone: "success" });
    } catch (thrown) {
      toast.show({ title: apiErrorOf(thrown)?.message ?? "Couldn't add the signed form. Please try again.", tone: "danger" });
    }
  };
  return (
    <>
      <input
        ref={input}
        type="file"
        accept={FORM_TYPES}
        hidden
        aria-label={`Signed form for ${purposeLabel(consent.purpose)}`}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file !== undefined) void onFile(file);
        }}
      />
      <Button
        variant="ghost"
        className="mt-1 px-2 py-1"
        icon={<Paperclip aria-hidden="true" className="size-4" />}
        disabled={busy}
        onClick={() => input.current?.click()}
      >
        {busy ? "Adding…" : "Add signed form"}
      </Button>
    </>
  );
}

/** The file input for the signed form, labelled by the surrounding `Field`. */
function FormFileInput({ onChoose }: { onChoose: (file: File | undefined, problem: string | undefined) => void }) {
  const { props: control } = useFieldControl({});
  return (
    <input
      {...control}
      type="file"
      accept={FORM_TYPES}
      className="text-sm"
      onChange={(event) => {
        const chosen = event.target.files?.[0];
        const problem = chosen === undefined ? undefined : formProblem(chosen);
        onChoose(chosen, problem);
        if (problem !== undefined) event.target.value = "";
      }}
    />
  );
}

function RecordConsentDialog({ patientId, active, onOpenChange }: { patientId: PatientId; active: ConsentPurpose[]; onOpenChange: () => void }) {
  const open = PURPOSES.filter((p) => !active.includes(p.value));
  const [purpose, setPurpose] = useState<ConsentPurpose>(open[0]?.value ?? "care");
  const [version, setVersion] = useState("");
  const [method, setMethod] = useState<ConsentMethod>("paper");
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const record = useRecordConsent(patientId);
  const form = useUploadForm(patientId);
  const toast = useToast();
  const busy = record.isPending || form.isPending;

  const submit = async () => {
    setError(undefined);
    try {
      // The form goes up first, so the consent is recorded with it in one step.
      const signature = file === undefined ? undefined : await form.upload(file);
      await record.mutateAsync({
        purpose,
        notice_version: version.trim(),
        method,
        ...(note.trim() === "" ? {} : { note: note.trim() }),
        ...(signature === undefined ? {} : { signature_attachment_id: signature }),
      });
      toast.show({ title: "Consent recorded", tone: "success" });
      onOpenChange();
    } catch (thrown) {
      setError(apiErrorOf(thrown)?.message ?? "Couldn't record that consent. Please try again.");
    }
  };

  return (
    <Dialog
      open
      onOpenChange={onOpenChange}
      title="Record consent"
      footer={
        <>
          <Button variant="secondary" onClick={onOpenChange}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              void submit();
            }}
            disabled={version.trim() === "" || open.length === 0 || busy}
          >
            {busy ? "Saving…" : "Save"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {open.length === 0 ? (
          <p className="text-sm text-muted">Every purpose already has an active consent. Withdraw one first to record a new one.</p>
        ) : (
          <Field label="Purpose" required hint={open.find((p) => p.value === purpose)?.help}>
            <Select options={open.map(({ value, label }) => ({ value, label }))} value={purpose} onValueChange={setPurpose} />
          </Field>
        )}
        <Field label="Notice version" required hint="The label printed on the notice the patient saw, such as v1 2026-10.">
          <TextInput
            value={version}
            maxLength={40}
            onChange={(event) => {
              setVersion(event.target.value);
            }}
          />
        </Field>
        <Field label="How was it given?">
          <Select options={METHODS} value={method} onValueChange={setMethod} />
        </Field>
        <Field label="Signed form" hint="Optional. A photo or scan of the form the patient signed (JPEG, PNG or PDF, up to 10 MB).">
          <FormFileInput
            onChoose={(chosen, problem) => {
              setError(problem);
              setFile(problem === undefined ? chosen : undefined);
            }}
          />
        </Field>
        <Field label="Note" hint="For example the paper form number. No health details.">
          <TextArea
            rows={2}
            maxLength={500}
            value={note}
            onChange={(event) => {
              setNote(event.target.value);
            }}
          />
        </Field>
        {error === undefined ? null : (
          <p role="alert" className="text-sm font-medium text-danger-text">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}

function WithdrawDialog({ patientId, consent, onOpenChange }: { patientId: PatientId; consent: Consent; onOpenChange: () => void }) {
  const [method, setMethod] = useState<ConsentMethod>("verbal");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);
  const withdraw = useWithdrawConsent(patientId);
  const toast = useToast();

  const submit = () => {
    setError(undefined);
    withdraw.mutate(
      { id: consent.id, input: { method, ...(note.trim() === "" ? {} : { note: note.trim() }) } },
      {
        onSuccess: () => {
          toast.show({ title: "Withdrawal recorded", tone: "success" });
          onOpenChange();
        },
        onError: (thrown) => {
          setError(apiErrorOf(thrown)?.message ?? "Couldn't record the withdrawal. Please try again.");
        },
      },
    );
  };

  return (
    <Dialog
      open
      onOpenChange={onOpenChange}
      title={`Withdraw consent: ${purposeLabel(consent.purpose)}`}
      footer={
        <>
          <Button variant="secondary" onClick={onOpenChange}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={withdraw.isPending}>
            {withdraw.isPending ? "Saving…" : "Record withdrawal"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted">The record stays as history. The clinic must stop that use of the patient's data.</p>
        <Field label="How did they withdraw?">
          <Select options={METHODS} value={method} onValueChange={setMethod} />
        </Field>
        <Field label="Note">
          <TextArea
            rows={2}
            maxLength={500}
            value={note}
            onChange={(event) => {
              setNote(event.target.value);
            }}
          />
        </Field>
        {error === undefined ? null : (
          <p role="alert" className="text-sm font-medium text-danger-text">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}
