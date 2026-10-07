import { Plus } from "lucide-react";
import { useState } from "react";

import { apiErrorOf, type Consent, type ConsentMethod, type ConsentPurpose, type PatientId } from "@aarogyam/api-client";
import { ApiErrorNotice, formatDate } from "@aarogyam/app-kit";
import { Button, Dialog, Field, Select, TextArea, TextInput, useToast } from "@sakalya/ui";

import { Empty, MkCard, Tag, statusTone } from "../../components/mk/index.js";
import { SkeletonRows } from "../../components/skeleton-rows.js";
import { useClinic } from "../../clinic.js";
import { useConsents, useRecordConsent, useWithdrawConsent } from "./queries.js";

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

function RecordConsentDialog({ patientId, active, onOpenChange }: { patientId: PatientId; active: ConsentPurpose[]; onOpenChange: () => void }) {
  const open = PURPOSES.filter((p) => !active.includes(p.value));
  const [purpose, setPurpose] = useState<ConsentPurpose>(open[0]?.value ?? "care");
  const [version, setVersion] = useState("");
  const [method, setMethod] = useState<ConsentMethod>("paper");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);
  const record = useRecordConsent(patientId);
  const toast = useToast();

  const submit = () => {
    setError(undefined);
    record.mutate(
      {
        purpose,
        notice_version: version.trim(),
        method,
        ...(note.trim() === "" ? {} : { note: note.trim() }),
      },
      {
        onSuccess: () => {
          toast.show({ title: "Consent recorded", tone: "success" });
          onOpenChange();
        },
        onError: (thrown) => {
          setError(apiErrorOf(thrown)?.message ?? "Couldn't record that consent. Please try again.");
        },
      },
    );
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
          <Button onClick={submit} disabled={version.trim() === "" || open.length === 0 || record.isPending}>
            {record.isPending ? "Saving…" : "Save"}
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
