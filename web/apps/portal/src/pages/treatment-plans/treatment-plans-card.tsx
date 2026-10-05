import { Check, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import { apiErrorOf, type PatientId, type Plan, type VisitId } from "@aarogyam/api-client";
import { ApiErrorNotice, formatRupees } from "@aarogyam/app-kit";
import { Button, Card, Dialog, EmptyState, Field, Pill, Skeleton, TextInput, useToast } from "@sakalya/ui";

import { useAcceptPlan, useCreatePlan, usePlans, useSetPlanItemStatus } from "./queries.js";

function planTone(status: string): "neutral" | "success" | "warning" | "danger" {
  return status === "completed" ? "success" : status === "declined" ? "danger" : status === "proposed" ? "neutral" : "warning";
}

/** A patient's treatment plans on the visit screen: propose, accept and mark items done, with or without an open visit. */
export function TreatmentPlansCard({ patientId, visitId, canWrite }: { patientId: PatientId; visitId: VisitId; canWrite: boolean }) {
  const plans = usePlans(patientId);
  const [creating, setCreating] = useState(false);
  return (
    <Card
      title="Treatment plans"
      action={
        canWrite ? (
          <Button
            variant="secondary"
            icon={<Plus aria-hidden="true" className="size-4" />}
            onClick={() => {
              setCreating(true);
            }}
          >
            New plan
          </Button>
        ) : undefined
      }
    >
      {plans.isPending ? (
        <Skeleton shape="block" />
      ) : plans.isError ? (
        <ApiErrorNotice title="Couldn't load treatment plans" error={plans.error} onRetry={() => void plans.refetch()} />
      ) : plans.data.items.length === 0 ? (
        <EmptyState title="No treatment plans yet" icon={null} />
      ) : (
        <div className="flex flex-col gap-4">
          {plans.data.items.map((plan) => (
            <PlanView key={plan.id} patientId={patientId} plan={plan} canWrite={canWrite} />
          ))}
        </div>
      )}
      {creating ? (
        <NewPlanDialog
          patientId={patientId}
          visitId={visitId}
          onOpenChange={() => {
            setCreating(false);
          }}
        />
      ) : null}
    </Card>
  );
}

function PlanView({ patientId, plan, canWrite }: { patientId: PatientId; plan: Plan; canWrite: boolean }) {
  const accept = useAcceptPlan(patientId);
  const finish = useSetPlanItemStatus(patientId);
  const toast = useToast();
  return (
    <div className="rounded-2xl border border-border p-4">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-bold text-text">{plan.title}</h3>
        <Pill tone={planTone(plan.status)}>{plan.status.replace("_", " ")}</Pill>
        <span className="ms-auto text-sm font-semibold tabular-nums text-text">{formatRupees(plan.estimate_paise)}</span>
        {canWrite && plan.status === "proposed" ? (
          <Button
            variant="secondary"
            disabled={accept.isPending}
            onClick={() => {
              accept.mutate(
                { id: plan.id, input: {} },
                {
                  onSuccess: () => {
                    toast.show({ title: "Plan accepted", tone: "success" });
                  },
                  onError: (thrown) => {
                    toast.show({ title: apiErrorOf(thrown)?.message ?? "Couldn't accept that plan.", tone: "danger" });
                  },
                },
              );
            }}
          >
            Accept plan
          </Button>
        ) : null}
      </div>
      <ul aria-label={`Items of ${plan.title}`} className="divide-y divide-border">
        {plan.items.map((item) => (
          <li key={item.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
            <span className="font-semibold text-text">
              {item.name}
              {item.tooth == null ? "" : ` · Tooth ${String(item.tooth)}`}
            </span>
            <span className="text-xs text-muted">Phase {item.phase}</span>
            <Pill tone={item.status === "done" ? "success" : item.status === "cancelled" ? "danger" : item.status === "accepted" ? "warning" : "neutral"}>
              {item.status}
            </Pill>
            <span className="ms-auto tabular-nums text-text">{formatRupees(item.estimate_paise)}</span>
            {canWrite && item.status === "accepted" ? (
              <Button
                variant="ghost"
                icon={<Check aria-hidden="true" className="size-4" />}
                aria-label={`Mark done: ${item.name}`}
                disabled={finish.isPending}
                onClick={() => {
                  finish.mutate(
                    { item, status: "done" },
                    {
                      onSuccess: () => {
                        toast.show({ title: "Marked as done", tone: "success" });
                      },
                      onError: (thrown) => {
                        toast.show({ title: apiErrorOf(thrown)?.message ?? "Couldn't record that.", tone: "danger" });
                      },
                    },
                  );
                }}
              >
                Mark done
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

interface DraftItem {
  key: number;
  name: string;
  tooth: string;
  rupees: string;
}

function NewPlanDialog({ patientId, visitId, onOpenChange }: { patientId: PatientId; visitId: VisitId; onOpenChange: () => void }) {
  const [title, setTitle] = useState("");
  const [rows, setRows] = useState<DraftItem[]>([{ key: 0, name: "", tooth: "", rupees: "" }]);
  const [error, setError] = useState<string | undefined>(undefined);
  const create = useCreatePlan(patientId);
  const toast = useToast();

  const update = (key: number, changes: Partial<DraftItem>) => {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...changes } : row)));
  };
  const valid = title.trim() !== "" && rows.every((r) => r.name.trim() !== "" && Number.isFinite(Number(r.rupees)) && r.rupees.trim() !== "");

  const submit = () => {
    setError(undefined);
    create.mutate(
      {
        title: title.trim(),
        visit_id: visitId,
        items: rows.map((r) => ({
          name: r.name.trim(),
          ...(r.tooth.trim() === "" ? {} : { tooth: Number(r.tooth) }),
          estimate_paise: Math.round(Number(r.rupees) * 100),
        })),
      },
      {
        onSuccess: () => {
          toast.show({ title: "Plan proposed", tone: "success" });
          onOpenChange();
        },
        onError: (thrown) => {
          setError(apiErrorOf(thrown)?.message ?? "Couldn't save that plan. Please try again.");
        },
      },
    );
  };

  return (
    <Dialog
      open
      onOpenChange={onOpenChange}
      title="New treatment plan"
      footer={
        <>
          <Button variant="secondary" onClick={onOpenChange}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!valid || create.isPending}>
            {create.isPending ? "Saving…" : "Save plan"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Title" required>
          <TextInput
            value={title}
            onChange={(event) => {
              setTitle(event.target.value);
            }}
          />
        </Field>
        {rows.map((row, index) => (
          <div key={row.key} className="flex flex-wrap items-end gap-2">
            <Field label={`Procedure ${String(index + 1)}`} className="min-w-40 flex-1">
              <TextInput
                value={row.name}
                onChange={(event) => {
                  update(row.key, { name: event.target.value });
                }}
              />
            </Field>
            <Field label={`Tooth ${String(index + 1)}`} className="w-20">
              <TextInput
                inputMode="numeric"
                value={row.tooth}
                onChange={(event) => {
                  update(row.key, { tooth: event.target.value });
                }}
              />
            </Field>
            <Field label={`Estimate ${String(index + 1)} (rupees)`} className="w-32">
              <TextInput
                inputMode="decimal"
                value={row.rupees}
                onChange={(event) => {
                  update(row.key, { rupees: event.target.value });
                }}
              />
            </Field>
            {rows.length > 1 ? (
              <Button
                variant="ghost"
                aria-label={`Remove procedure ${String(index + 1)}`}
                icon={<Trash2 aria-hidden="true" className="size-4" />}
                onClick={() => {
                  setRows((current) => current.filter((r) => r.key !== row.key));
                }}
              >
                Remove
              </Button>
            ) : null}
          </div>
        ))}
        <div>
          <Button
            variant="secondary"
            icon={<Plus aria-hidden="true" className="size-4" />}
            onClick={() => {
              setRows((current) => [...current, { key: Math.max(...current.map((r) => r.key)) + 1, name: "", tooth: "", rupees: "" }]);
            }}
          >
            Add procedure
          </Button>
        </div>
        {error === undefined ? null : (
          <p role="alert" className="text-sm font-medium text-danger-text">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}
