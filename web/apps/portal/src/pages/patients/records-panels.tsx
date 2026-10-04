import { Plus } from "lucide-react";
import { useNavigate } from "react-router";

import type { Invoice, PatientId, Prescription } from "@aarogyam/api-client";
import { ApiErrorNotice, formatDate, formatRupees } from "@aarogyam/app-kit";
import { Button, Card, EmptyState, Link, Pill, Skeleton, useToast } from "@sakalya/ui";

import { useClinic } from "../../clinic.js";
import { useInvoices } from "../billing/queries.js";
import { useCreatePrescription, usePrescriptions } from "../prescriptions/queries.js";

const RECENT = 5;

/** The patient's latest bills, with a way to start a new one and a link to all of them. */
export function BillsPanel({ patientId }: { patientId: PatientId }) {
  const { can } = useClinic();
  const navigate = useNavigate();
  const invoices = useInvoices({ patientId });
  if (!can("billing.read")) {
    return <EmptyState title="Billing is hidden for your role" description="Ask the clinic owner if you need to see bills." />;
  }
  const items: readonly Invoice[] = invoices.data?.items.slice(0, RECENT) ?? [];
  return (
    <div className="flex flex-col gap-4">
      {can("billing.write") ? (
        <div className="flex flex-wrap gap-2">
          <Button
            icon={<Plus aria-hidden="true" className="size-4" />}
            onClick={() => {
              void navigate("/billing/invoices/new");
            }}
          >
            New bill
          </Button>
        </div>
      ) : null}
      {invoices.isPending ? (
        <Skeleton shape="block" />
      ) : invoices.isError ? (
        <ApiErrorNotice title="Couldn't load bills" error={invoices.error} onRetry={() => void invoices.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState title="No bills yet" description="Bills, payments and dues for this patient will appear here." />
      ) : (
        <Card>
          <ul aria-label="Recent bills" className="flex flex-col gap-2">
            {items.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-2 text-sm">
                <Link href={`/billing/invoices/${i.id}`} className="font-mono text-xs font-semibold text-primary-text hover:underline">
                  {i.number ?? "Draft"}
                </Link>
                <Pill tone={i.status === "issued" ? "success" : i.status === "void" ? "danger" : "neutral"}>{i.status}</Pill>
                {i.payment_state == null ? null : <Pill tone={i.payment_state === "paid" ? "success" : "warning"}>{i.payment_state}</Pill>}
                <span className="ms-auto font-semibold tabular-nums text-text">{formatRupees(i.total_paise)}</span>
                <span className="text-muted">{formatDate(i.issued_at ?? i.created_at)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

/** The patient's latest prescriptions, with a way to start a new one and a link to all of them. */
export function PrescriptionsPanel({ patientId }: { patientId: PatientId }) {
  const { can } = useClinic();
  const navigate = useNavigate();
  const toast = useToast();
  const prescriptions = usePrescriptions(patientId);
  const create = useCreatePrescription(patientId);
  const items: readonly Prescription[] = prescriptions.data?.items.slice(0, RECENT) ?? [];
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        {can("prescriptions.issue") ? (
          <Button
            icon={<Plus aria-hidden="true" className="size-4" />}
            disabled={create.isPending}
            onClick={() => {
              create.mutate(
                {},
                {
                  onSuccess: (draft) => {
                    void navigate(`/prescriptions/${draft.id}`);
                  },
                  onError: () => {
                    toast.show({ title: "Couldn't start a prescription.", tone: "danger" });
                  },
                },
              );
            }}
          >
            New prescription
          </Button>
        ) : null}
        <Button
          variant="secondary"
          onClick={() => {
            void navigate(`/patients/${patientId}/prescriptions`);
          }}
        >
          All prescriptions
        </Button>
      </div>
      {prescriptions.isPending ? (
        <Skeleton shape="block" />
      ) : prescriptions.isError ? (
        <ApiErrorNotice title="Couldn't load prescriptions" error={prescriptions.error} onRetry={() => void prescriptions.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState title="No prescriptions yet" description="Drafts and issued prescriptions will appear here." />
      ) : (
        <Card>
          <ul aria-label="Recent prescriptions" className="flex flex-col gap-2">
            {items.map((rx) => (
              <li key={rx.id} className="flex flex-wrap items-center gap-2 text-sm">
                <Link href={`/prescriptions/${rx.id}`} className="font-mono text-xs font-semibold text-primary-text hover:underline">
                  {rx.number ?? "Draft"}
                </Link>
                <Pill tone={rx.status === "issued" ? "success" : rx.status === "cancelled" ? "danger" : "neutral"}>{rx.status}</Pill>
                <span className="text-muted">{rx.items.map((item) => item.drug_name).join(", ")}</span>
                <span className="ms-auto text-muted">{formatDate(rx.issued_at ?? rx.created_at)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
