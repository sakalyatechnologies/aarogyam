import { ChevronLeft, Copy, Pill, Printer, RotateCcw, Share2, Trash2 } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";

import {
  apiErrorOf,
  prescriptionId as prescriptionIdSchema,
  type Alert,
  type PatientMessage,
  type Prescription,
  type RxItem,
} from "@aarogyam/api-client";
import { ApiErrorNotice, formatDate, formatDateTime, useDebouncedValue, useDocumentTitle } from "@aarogyam/app-kit";
import { Button, Card, DateInput, Dialog, Field, FormActions, Pill as StatusPill, Select, Skeleton, TextArea, TextInput, useToast } from "@sakalya/ui";

import { useClinic } from "../../clinic.js";
import {
  useCancelPrescription,
  useCreateShareLink,
  useDrugSearch,
  useEditPrescription,
  useIssuePrescription,
  usePrescription,
} from "./queries.js";
import { PageHeader } from "../../components/mk/index.js";
import { patientPath } from "../../lib/patients.js";
import { joinParts } from "../../lib/text.js";

const TIMINGS = [
  { value: "", label: "Not set" },
  { value: "before_food", label: "Before food" },
  { value: "after_food", label: "After food" },
  { value: "empty_stomach", label: "Empty stomach" },
  { value: "bedtime", label: "Bedtime" },
  { value: "sos", label: "As needed (SOS)" },
  { value: "as_directed", label: "As directed" },
];

export function PrescriptionPage() {
  const params = useParams();
  const parsed = prescriptionIdSchema.safeParse(params.id);
  const id = parsed.success ? parsed.data : undefined;
  const rx = usePrescription(id);
  useDocumentTitle(rx.data?.number ?? "Prescription", "Aarogyam");

  if (id === undefined) {
    return <ApiErrorNotice title="That prescription address isn't valid" error={{ status: 404, code: "not_found", message: "No such prescription." }} />;
  }
  if (rx.isPending) {
    return (
      <div className="p-6" role="status" aria-label="Loading the prescription">
        <Skeleton shape="block" />
      </div>
    );
  }
  if (rx.isError) {
    return <ApiErrorNotice title="Couldn't load this prescription" error={rx.error} onRetry={() => void rx.refetch()} />;
  }
  return <PrescriptionBody rx={rx.data} />;
}

function PrescriptionBody({ rx }: { rx: Prescription }) {
  const navigate = useNavigate();
  const { can } = useClinic();
  const canIssue = can("prescriptions.issue");
  const [shareOpen, setShareOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [sent, setSent] = useState<PatientMessage>();

  const rxTab = `${patientPath(rx.patient)}?tab=prescriptions`;
  return (
    <>
      <Link to={rxTab} className="mk-back">
        <ChevronLeft aria-hidden="true" /> {rx.patient.name} · Rx
      </Link>
      <nav aria-label="Breadcrumb" className="mk-crumbs">
        <ol>
          <li>
            <Link to="/patients">Patients</Link>
          </li>
          <li>
            <Link to={patientPath(rx.patient)}>{rx.patient.name}</Link>
          </li>
          <li>
            <Link to={rxTab}>Rx</Link>
          </li>
          <li aria-current="page">{rx.number ?? "Draft"}</li>
        </ol>
      </nav>
      <PageHeader
        title={rx.number ?? "Draft prescription"}
        subtitle={`${rx.patient.name} · ${rx.patient.number}`}
        end={
          <div className="flex flex-wrap gap-2">
            {rx.status === "issued" ? (
              <>
                <Button
                  variant="secondary"
                  icon={<Printer aria-hidden="true" className="size-4" />}
                  onClick={() => {
                    void navigate(`/prescriptions/${rx.id}/print`, { state: { pin: sent?.pin ?? null } });
                  }}
                >
                  Print
                </Button>
                <Button
                  variant="secondary"
                  icon={<Share2 aria-hidden="true" className="size-4" />}
                  onClick={() => {
                    setShareOpen(true);
                  }}
                >
                  Share with patient
                </Button>
                {canIssue ? (
                  <Button
                    variant="secondary"
                    className="border-danger text-danger-text hover:bg-danger-soft"
                    icon={<RotateCcw aria-hidden="true" className="size-4" />}
                    onClick={() => {
                      setCancelOpen(true);
                    }}
                  >
                    Cancel and reissue
                  </Button>
                ) : null}
              </>
            ) : null}
          </div>
        }
      />
      <div className="flex flex-col gap-4">
        {rx.status === "issued" && sent !== undefined ? <SentNotice message={sent} /> : null}
        <Card>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <StatusPill tone={rx.status === "issued" ? "success" : rx.status === "cancelled" ? "danger" : "neutral"}>{rx.status}</StatusPill>
            {rx.issued_at == null ? null : <span className="text-xs text-muted">Issued {formatDateTime(rx.issued_at)}</span>}
            {rx.supersedes_id == null ? null : <span className="text-xs text-muted">Reissue of an earlier prescription</span>}
          </div>
          {rx.status === "draft" && canIssue ? <DraftEditor rx={rx} onIssued={setSent} /> : <ReadOnlyView rx={rx} />}
        </Card>
      </div>
      <ShareDialog
        open={shareOpen}
        rxId={rx.id}
        onClose={() => {
          setShareOpen(false);
        }}
      />
      <CancelDialog
        open={cancelOpen}
        rx={rx}
        onClose={() => {
          setCancelOpen(false);
        }}
        onCancelled={(draftId) => {
          setCancelOpen(false);
          if (draftId !== undefined) {
            void navigate(`/prescriptions/${draftId}`);
          }
        }}
      />
    </>
  );
}

function ReadOnlyView({ rx }: { rx: Prescription }) {
  return (
    <div className="flex flex-col gap-3">
      {rx.diagnosis_text == null ? null : (
        <p className="text-sm">
          <span className="font-semibold text-text">Diagnosis: </span>
          {rx.diagnosis_text}
        </p>
      )}
      <ul className="divide-y divide-border">
        {rx.items.map((item, index) => (
          <li key={index} className="py-2 text-sm">
            <p className="font-semibold text-text">
              {item.drug_name} {item.strength}
            </p>
            <p className="text-muted">
              {joinParts([
                item.dose,
                item.frequency,
                item.timing == null || item.timing === "" ? null : (TIMINGS.find((t) => t.value === item.timing)?.label ?? item.timing),
                item.duration_days == null ? null : `${String(item.duration_days)} days`,
              ])}
            </p>
            {item.instructions == null || item.instructions === "" ? null : <p className="text-xs text-muted">{item.instructions}</p>}
          </li>
        ))}
      </ul>
      {rx.advice == null ? null : (
        <p className="text-sm">
          <span className="font-semibold text-text">Advice: </span>
          {rx.advice}
        </p>
      )}
      {rx.follow_up_on == null ? null : (
        <p className="text-sm">
          <span className="font-semibold text-text">Follow up: </span>
          {formatDate(rx.follow_up_on)}
        </p>
      )}
      {rx.alerts.length === 0 ? null : (
        <div className="rounded-xl bg-warning-soft p-3 text-sm text-warning-text">
          <p className="font-semibold">Issued with an allergy override: {rx.override_reason}</p>
          <ul className="mt-1 list-inside list-disc">
            {rx.alerts.map((alert, index) => (
              <li key={index}>{alert.message}</li>
            ))}
          </ul>
        </div>
      )}
      {rx.cancel_reason == null ? null : <p className="text-sm text-danger-text">Cancelled: {rx.cancel_reason}</p>}
    </div>
  );
}

const NOT_SENT_REASONS: Record<string, string> = {
  no_email: "No email on file; give the printed copy.",
  declined: "Not emailed, as you chose; give the printed copy.",
  no_portal: "The clinic has no portal address yet, so no link could be sent; give the printed copy.",
};

/** Shown once after issuing: whether the patient was emailed, and the PIN to tell them. */
function SentNotice({ message }: { message: PatientMessage }) {
  const sent = message.status === "sent";
  return (
    <Card>
      <div role="status" className="flex flex-col gap-1">
        <p className="text-sm font-semibold text-text">{sent ? "Sent to patient by email" : "Not sent to the patient"}</p>
        {sent ? (
          <>
            <p className="text-sm text-muted">Tell the patient this PIN, or write it on their copy. It isn't in the email and is shown only now.</p>
            <p className="font-mono text-2xl tracking-widest" aria-label="Patient PIN">
              {message.pin}
            </p>
            {message.expires_at == null ? null : <p className="text-xs text-muted">The link works until {formatDateTime(message.expires_at)}.</p>}
          </>
        ) : (
          <p className="text-sm text-muted">{NOT_SENT_REASONS[message.reason ?? ""] ?? "Give the printed copy."}</p>
        )}
      </div>
    </Card>
  );
}

function DraftEditor({ rx, onIssued }: { rx: Prescription; onIssued: (message: PatientMessage) => void }) {
  const toast = useToast();
  const edit = useEditPrescription(rx.id, rx.patient.id);
  const issue = useIssuePrescription(rx.id, rx.patient.id);
  const [items, setItems] = useState<RxItem[]>(rx.items);
  const [diagnosis, setDiagnosis] = useState(rx.diagnosis_text ?? "");
  const [advice, setAdvice] = useState(rx.advice ?? "");
  const [followUp, setFollowUp] = useState(rx.follow_up_on ?? "");
  const [query, setQuery] = useState("");
  const [blockedAlerts, setBlockedAlerts] = useState<Alert[]>();
  const [overrideReason, setOverrideReason] = useState("");
  const [error, setError] = useState<string>();
  const debouncedQuery = useDebouncedValue(query, 250);
  const search = useDrugSearch({ q: debouncedQuery, limit: 8 });

  const addDrug = (drug: NonNullable<typeof search.data>["items"][number]) => {
    setItems((prev) => [
      ...prev,
      {
        drug_id: drug.id,
        drug_name: drug.generic_name,
        form: drug.form,
        strength: drug.strength,
        dose: drug.default_dose,
        frequency: drug.default_frequency,
        timing: drug.default_timing ?? null,
        duration_days: drug.default_duration_days ?? null,
        instructions: null,
      },
    ]);
    setQuery("");
  };

  const addFreeText = () => {
    setItems((prev) => [...prev, { drug_name: "", frequency: "", timing: null, duration_days: null, dose: "", instructions: null }]);
  };

  const updateItem = (index: number, changes: Partial<RxItem>) => {
    setItems((prev) => prev.map((item, i) => (i === index ? { ...item, ...changes } : item)));
  };

  const save = async () => {
    setError(undefined);
    await edit.mutateAsync({
      items,
      diagnosis_text: diagnosis.trim() === "" ? null : diagnosis.trim(),
      advice: advice.trim() === "" ? null : advice.trim(),
      follow_up_on: followUp === "" ? null : followUp,
    });
  };

  const onIssue = async (withOverride?: string) => {
    setError(undefined);
    try {
      await save();
      const issued = await issue.mutateAsync(withOverride === undefined ? {} : { override_reason: withOverride });
      onIssued(issued.patient_message);
      setBlockedAlerts(undefined);
      toast.show({ title: "Prescription issued", tone: "success" });
    } catch (thrown) {
      const apiError = apiErrorOf(thrown);
      if (apiError?.alerts !== undefined && apiError.alerts.length > 0) {
        setBlockedAlerts(apiError.alerts);
      } else {
        setError(apiError?.message ?? "Couldn't issue this prescription. Please try again.");
      }
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <Field label="Diagnosis">
        <TextInput
          value={diagnosis}
          onChange={(event) => {
            setDiagnosis(event.currentTarget.value);
          }}
        />
      </Field>

      <div>
        <p className="mb-2 text-sm font-semibold text-text">Medicines</p>
        {items.length === 0 ? <p className="text-sm text-muted">No medicines yet.</p> : null}
        <ul className="flex flex-col gap-3">
          {items.map((item, index) => (
            <li key={index} className="grid grid-cols-1 gap-2 rounded-2xl border border-border p-3 sm:grid-cols-[2fr_1fr_1fr_1fr_auto]">
              <Field label="Medicine" hideLabel>
                <TextInput
                  placeholder="Medicine name"
                  disabled={item.drug_id != null}
                  value={item.drug_name ?? ""}
                  onChange={(event) => {
                    updateItem(index, { drug_name: event.currentTarget.value });
                  }}
                />
              </Field>
              <Field label="Dose" hideLabel>
                <TextInput
                  placeholder="Dose, e.g. 1 tablet"
                  value={item.dose ?? ""}
                  onChange={(event) => {
                    updateItem(index, { dose: event.currentTarget.value });
                  }}
                />
              </Field>
              <Field label="Frequency" hideLabel>
                <TextInput
                  placeholder="1-0-1"
                  value={item.frequency ?? ""}
                  onChange={(event) => {
                    updateItem(index, { frequency: event.currentTarget.value });
                  }}
                />
              </Field>
              <Field label="Timing" hideLabel>
                <Select
                  options={TIMINGS}
                  value={item.timing ?? ""}
                  onValueChange={(timing) => {
                    updateItem(index, { timing: timing === "" ? null : timing });
                  }}
                />
              </Field>
              <Button
                variant="ghost"
                aria-label="Remove medicine"
                onClick={() => {
                  setItems((prev) => prev.filter((_, i) => i !== index));
                }}
              >
                <Trash2 aria-hidden="true" className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
        <div className="relative mt-3">
          <Field label="Search a medicine" hint="By generic or brand name">
            <TextInput
              value={query}
              onChange={(event) => {
                setQuery(event.currentTarget.value);
              }}
            />
          </Field>
          {query.trim() === "" ? null : (
            <ul className="mt-1 max-h-48 divide-y divide-border overflow-y-auto rounded-2xl border border-border">
              {search.isFetching ? (
                <li className="px-4 py-2.5 text-sm text-muted">Searching…</li>
              ) : (search.data?.items.length ?? 0) === 0 ? (
                <li className="px-4 py-2.5 text-sm text-muted">No matches. Add it as free text below.</li>
              ) : (
                search.data?.items.map((drug) => (
                  <li key={drug.id}>
                    <button
                      type="button"
                      onClick={() => {
                        addDrug(drug);
                      }}
                      className="flex w-full items-center justify-between px-4 py-2 text-left text-sm hover:bg-surface-muted"
                    >
                      <span className="font-semibold text-text">
                        {drug.generic_name} {drug.strength}
                      </span>
                      <span className="text-xs text-muted">{drug.brand_name ?? drug.form}</span>
                    </button>
                  </li>
                ))
              )}
            </ul>
          )}
        </div>
        <Button variant="secondary" className="mt-2" icon={<Pill aria-hidden="true" className="size-4" />} onClick={addFreeText}>
          Add free-text medicine
        </Button>
      </div>

      <Field label="Advice">
        <TextArea
          rows={2}
          value={advice}
          onChange={(event) => {
            setAdvice(event.currentTarget.value);
          }}
        />
      </Field>
      <Field label="Follow-up date" hint="Optional">
        <DateInput
          value={followUp}
          onChange={(event) => {
            setFollowUp(event.currentTarget.value);
          }}
        />
      </Field>

      {error === undefined ? null : (
        <p role="alert" className="rounded-xl bg-danger-soft px-4 py-3 text-sm font-medium text-danger-text">
          {error}
        </p>
      )}

      <FormActions>
        <Button
          variant="secondary"
          disabled={edit.isPending}
          onClick={() => {
            void save().then(() => {
              toast.show({ title: "Draft saved", tone: "success" });
            });
          }}
        >
          Save draft
        </Button>
        <Button disabled={edit.isPending || issue.isPending || items.length === 0} onClick={() => void onIssue()}>
          {issue.isPending ? "Issuing…" : "Issue prescription"}
        </Button>
      </FormActions>

      <AlertsDialog
        alerts={blockedAlerts}
        reason={overrideReason}
        setReason={setOverrideReason}
        pending={issue.isPending}
        onClose={() => {
          setBlockedAlerts(undefined);
          setOverrideReason("");
        }}
        onConfirm={() => {
          void onIssue(overrideReason).then(() => {
            setOverrideReason("");
          });
        }}
      />
    </div>
  );
}

function AlertsDialog({
  alerts,
  reason,
  setReason,
  pending,
  onClose,
  onConfirm,
}: {
  alerts: Alert[] | undefined;
  reason: string;
  setReason: (value: string) => void;
  pending: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog
      open={alerts !== undefined}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title="Allergy alert"
      description="This prescription may conflict with a recorded allergy. Give a reason to issue it anyway."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Review the medicines
          </Button>
          <Button
            className="border-danger text-danger-text hover:bg-danger-soft"
            variant="secondary"
            disabled={pending || reason.trim() === ""}
            onClick={onConfirm}
          >
            {pending ? "Issuing…" : "Issue anyway"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <ul className="flex flex-col gap-2">
          {(alerts ?? []).map((alert, index) => (
            <li key={index} className="rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger-text">
              {alert.message}
            </li>
          ))}
        </ul>
        <Field label="Reason to override" required>
          <TextArea
            rows={2}
            value={reason}
            onChange={(event) => {
              setReason(event.currentTarget.value);
            }}
          />
        </Field>
      </div>
    </Dialog>
  );
}

function ShareDialog({ open, rxId, onClose }: { open: boolean; rxId: Prescription["id"]; onClose: () => void }) {
  const create = useCreateShareLink(rxId);
  const toast = useToast();

  const close = () => {
    onClose();
    create.reset();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
      title="Share with the patient"
      description={create.data === undefined ? "Makes a seven-day link and a 6-digit PIN to print or read out." : "Shown once — print it or read it out now."}
      footer={
        create.data === undefined ? (
          <>
            <Button variant="secondary" onClick={close}>
              Cancel
            </Button>
            <Button
              disabled={create.isPending}
              onClick={() => {
                create.mutate();
              }}
            >
              {create.isPending ? "Creating…" : "Create link"}
            </Button>
          </>
        ) : (
          <Button
            icon={<Copy aria-hidden="true" className="size-4" />}
            onClick={() => {
              const url = `${window.location.origin}/shared/${create.data.token}`;
              void navigator.clipboard.writeText(url).then(
                () => toast.show({ title: "Link copied", tone: "success" }),
                () => toast.show({ title: "Couldn't copy; select the link and copy it", tone: "warning" }),
              );
            }}
          >
            Copy link
          </Button>
        )
      }
    >
      {create.data === undefined ? null : (
        <div className="flex flex-col gap-4">
          <Field label="Link">
            <TextInput readOnly value={`${window.location.origin}/shared/${create.data.token}`} className="font-mono" onFocus={(event) => { event.currentTarget.select(); }} />
          </Field>
          <Field label="PIN">
            <TextInput readOnly value={create.data.pin} className="font-mono text-lg tracking-widest" />
          </Field>
          <p className="text-xs text-muted">Valid until {formatDateTime(create.data.expires_at)}.</p>
        </div>
      )}
    </Dialog>
  );
}

function CancelDialog({
  open,
  rx,
  onClose,
  onCancelled,
}: {
  open: boolean;
  rx: Prescription;
  onClose: () => void;
  onCancelled: (draftId: string | undefined) => void;
}) {
  const cancel = useCancelPrescription(rx.id, rx.patient.id);
  const [reason, setReason] = useState("");
  const [reissue, setReissue] = useState(true);
  const [error, setError] = useState<string>();

  const close = () => {
    onClose();
    setReason("");
    setReissue(true);
    setError(undefined);
  };

  const submit = () => {
    setError(undefined);
    cancel.mutate(
      { reason, reissue },
      {
        onSuccess: (result) => {
          close();
          onCancelled(result.draft?.id);
        },
        onError: (thrown) => {
          setError(apiErrorOf(thrown)?.message ?? "Couldn't cancel this prescription. Please try again.");
        },
      },
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
      title="Cancel this prescription"
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Keep it
          </Button>
          <Button
            variant="secondary"
            className="border-danger text-danger-text hover:bg-danger-soft"
            disabled={cancel.isPending || reason.trim().length < 3}
            onClick={submit}
          >
            {cancel.isPending ? "Cancelling…" : "Cancel prescription"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Reason" required>
          <TextArea
            rows={2}
            value={reason}
            onChange={(event) => {
              setReason(event.currentTarget.value);
            }}
          />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={reissue}
            onChange={(event) => {
              setReissue(event.currentTarget.checked);
            }}
          />
          Start a corrected draft copied from it
        </label>
        {error === undefined ? null : (
          <p role="alert" className="text-sm font-medium text-danger-text">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}
