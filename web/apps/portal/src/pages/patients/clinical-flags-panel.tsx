import { AlertTriangle, Pencil, Plus } from "lucide-react";
import { useState } from "react";

import { apiErrorOf, type Allergy, type PatientId } from "@aarogyam/api-client";
import { ApiErrorNotice, formatDate } from "@aarogyam/app-kit";
import { Button, Dialog, Field, Select, Skeleton, TextArea, TextInput, useToast } from "@sakalya/ui";
import { MkCard, Tag, statusTone, Empty } from "../../components/mk/index.js";

import { useClinic } from "../../clinic.js";
import { useAddAllergy, useAddCondition, useClinicalFlags } from "../../queries.js";
import { useEditAllergy } from "./queries.js";

const SEVERITIES = [
  { value: "mild", label: "Mild" },
  { value: "moderate", label: "Moderate" },
  { value: "severe", label: "Severe" },
] as const;

/** Patient 360's safety banner: allergies and flagged conditions, prominent and never buried. */
export function ClinicalFlagsPanel({ patientId }: { patientId: PatientId }) {
  const { can } = useClinic();
  const flags = useClinicalFlags(patientId);
  const [addingAllergy, setAddingAllergy] = useState(false);
  const [addingCondition, setAddingCondition] = useState(false);
  const [editing, setEditing] = useState<Allergy | undefined>(undefined);

  if (flags.isPending) {
    return <Skeleton shape="block" />;
  }
  if (flags.isError) {
    return <ApiErrorNotice title="Couldn't load clinical flags" error={flags.error} onRetry={() => void flags.refetch()} />;
  }
  const data = flags.data;
  const hasFlags = data.allergy_count > 0 || data.condition_count > 0;
  const canWrite = can("clinical.write");

  return (
    <div className="flex flex-col gap-4">
      {!hasFlags ? (
        <Empty title="No clinical flags recorded yet">Allergies and conditions show here, prominently.</Empty>
      ) : (
        <MkCard>
          <div className="mb-3 flex items-center gap-2">
            <AlertTriangle aria-hidden="true" className={data.severe_allergy ? "size-5 text-danger" : "size-5 text-warning"} />
            <h3 className="text-base font-bold text-text">Clinical flags</h3>
            {data.severe_allergy ? <Tag tone={statusTone("danger")}>Severe allergy</Tag> : null}
          </div>
          {data.details_hidden ? (
            <p className="text-sm text-muted">
              {data.allergy_count} {data.allergy_count === 1 ? "allergy" : "allergies"} and {data.condition_count}{" "}
              {data.condition_count === 1 ? "condition" : "conditions"} on file. You need the clinical permission to see the detail.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {data.allergies.map((a) => (
                <li key={a.id} className="flex items-center gap-2 text-sm">
                  <Tag tone={statusTone(a.severity === "severe" ? "danger" : a.severity === "moderate" ? "warning" : "neutral")}>Allergy</Tag>
                  <span className="font-semibold text-text">{a.substance}</span>
                  {a.reaction == null ? null : <span className="text-muted">— {a.reaction}</span>}
                  {canWrite ? (
                    <Button
                      variant="ghost"
                      className="px-2 py-1"
                      aria-label={`Edit allergy: ${a.substance}`}
                      icon={<Pencil aria-hidden="true" className="size-4" />}
                      onClick={() => {
                        setEditing(a);
                      }}
                    >
                      Edit
                    </Button>
                  ) : null}
                </li>
              ))}
              {data.conditions.map((c) => (
                <li key={c.id} className="flex items-center gap-2 text-sm">
                  <Tag tone={statusTone("info")}>Condition</Tag>
                  <span className="font-semibold text-text">{c.display_text}</span>
                  {c.onset == null ? null : <span className="text-muted">since {formatDate(`${c.onset}T00:00:00Z`, "UTC")}</span>}
                </li>
              ))}
            </ul>
          )}
        </MkCard>
      )}
      {canWrite ? (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            icon={<Plus aria-hidden="true" className="size-4" />}
            onClick={() => {
              setAddingAllergy(true);
            }}
          >
            Add allergy
          </Button>
          <Button
            variant="secondary"
            icon={<Plus aria-hidden="true" className="size-4" />}
            onClick={() => {
              setAddingCondition(true);
            }}
          >
            Add condition
          </Button>
        </div>
      ) : null}
      {addingAllergy ? (
        <AddAllergyDialog
          patientId={patientId}
          onOpenChange={() => {
            setAddingAllergy(false);
          }}
        />
      ) : null}
      {editing === undefined ? null : (
        <EditAllergyDialog
          key={editing.id}
          patientId={patientId}
          allergy={editing}
          onOpenChange={() => {
            setEditing(undefined);
          }}
        />
      )}
      {addingCondition ? (
        <AddConditionDialog
          patientId={patientId}
          onOpenChange={() => {
            setAddingCondition(false);
          }}
        />
      ) : null}
    </div>
  );
}

function AddAllergyDialog({ patientId, onOpenChange }: { patientId: PatientId; onOpenChange: () => void }) {
  const [substance, setSubstance] = useState("");
  const [reaction, setReaction] = useState("");
  const [severity, setSeverity] = useState<(typeof SEVERITIES)[number]["value"]>("moderate");
  const [error, setError] = useState<string | undefined>(undefined);
  const add = useAddAllergy(patientId);
  const toast = useToast();

  const submit = () => {
    setError(undefined);
    add.mutate(
      { substance: substance.trim(), ...(reaction.trim() === "" ? {} : { reaction: reaction.trim() }), severity },
      {
        onSuccess: () => {
          toast.show({ title: "Allergy recorded", tone: "success" });
          onOpenChange();
        },
        onError: (thrown) => {
          setError(apiErrorOf(thrown)?.message ?? "Couldn't record that allergy. Please try again.");
        },
      },
    );
  };

  return (
    <Dialog
      open
      onOpenChange={onOpenChange}
      title="Add an allergy"
      footer={
        <>
          <Button variant="secondary" onClick={onOpenChange}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={substance.trim() === "" || add.isPending}>
            {add.isPending ? "Saving…" : "Save"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Substance" required>
          <TextInput
            value={substance}
            onChange={(event) => {
              setSubstance(event.target.value);
            }}
          />
        </Field>
        <Field label="Reaction">
          <TextInput
            value={reaction}
            onChange={(event) => {
              setReaction(event.target.value);
            }}
          />
        </Field>
        <Field label="Severity">
          <Select options={SEVERITIES} value={severity} onValueChange={setSeverity} />
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

function EditAllergyDialog({ patientId, allergy, onOpenChange }: { patientId: PatientId; allergy: Allergy; onOpenChange: () => void }) {
  const [reaction, setReaction] = useState(allergy.reaction ?? "");
  const [severity, setSeverity] = useState<(typeof SEVERITIES)[number]["value"]>(
    allergy.severity === "mild" || allergy.severity === "severe" ? allergy.severity : "moderate",
  );
  const [error, setError] = useState<string | undefined>(undefined);
  const edit = useEditAllergy(patientId);
  const toast = useToast();

  const save = (status: "active" | "resolved") => {
    setError(undefined);
    edit.mutate(
      { id: allergy.id, input: { reaction: reaction.trim(), severity, status } },
      {
        onSuccess: () => {
          toast.show({ title: status === "resolved" ? "Allergy marked inactive" : "Allergy updated", tone: "success" });
          onOpenChange();
        },
        onError: (thrown) => {
          setError(apiErrorOf(thrown)?.message ?? "Couldn't update that allergy. Please try again.");
        },
      },
    );
  };

  return (
    <Dialog
      open
      onOpenChange={onOpenChange}
      title={`Edit allergy: ${allergy.substance}`}
      footer={
        <>
          <Button variant="secondary" onClick={onOpenChange}>
            Cancel
          </Button>
          <Button
            variant="secondary"
            disabled={edit.isPending}
            onClick={() => {
              save("resolved");
            }}
          >
            Mark inactive
          </Button>
          <Button
            disabled={edit.isPending}
            onClick={() => {
              save("active");
            }}
          >
            {edit.isPending ? "Saving…" : "Save"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Reaction">
          <TextInput
            value={reaction}
            onChange={(event) => {
              setReaction(event.target.value);
            }}
          />
        </Field>
        <Field label="Severity">
          <Select options={SEVERITIES} value={severity} onValueChange={setSeverity} />
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

function AddConditionDialog({ patientId, onOpenChange }: { patientId: PatientId; onOpenChange: () => void }) {
  const [displayText, setDisplayText] = useState("");
  const [flagged, setFlagged] = useState(true);
  const [error, setError] = useState<string | undefined>(undefined);
  const add = useAddCondition(patientId);
  const toast = useToast();

  const submit = () => {
    setError(undefined);
    add.mutate(
      { display_text: displayText.trim(), flagged },
      {
        onSuccess: () => {
          toast.show({ title: "Condition recorded", tone: "success" });
          onOpenChange();
        },
        onError: (thrown) => {
          setError(apiErrorOf(thrown)?.message ?? "Couldn't record that condition. Please try again.");
        },
      },
    );
  };

  return (
    <Dialog
      open
      onOpenChange={onOpenChange}
      title="Add a condition"
      footer={
        <>
          <Button variant="secondary" onClick={onOpenChange}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={displayText.trim() === "" || add.isPending}>
            {add.isPending ? "Saving…" : "Save"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="What the doctor wrote" required hint="Such as 'Type 2 diabetes'">
          <TextArea
            value={displayText}
            onChange={(event) => {
              setDisplayText(event.target.value);
            }}
          />
        </Field>
        <label className="flex items-center gap-2 text-sm font-medium text-text">
          <input
            type="checkbox"
            checked={flagged}
            onChange={(event) => {
              setFlagged(event.target.checked);
            }}
          />
          Show in the clinical flags banner (diabetes, bleeding disorder, pregnancy…)
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
