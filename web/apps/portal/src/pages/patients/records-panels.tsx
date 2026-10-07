import { Plus, RotateCw } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";

import type { Invoice, PatientId, Prescription, RxValues } from "@aarogyam/api-client";
import { ApiErrorNotice, formatDate, formatRupees } from "@aarogyam/app-kit";
import { Button, Link, useToast } from "@sakalya/ui";
import { MkCard, Tag, statusTone, Empty } from "../../components/mk/index.js";

import { useClinic } from "../../clinic.js";
import { useInvoices } from "../billing/queries.js";
import { useCreatePrescription, useLastPrescription, usePrescriptions } from "../prescriptions/queries.js";
import { SkeletonRows } from "../../components/skeleton-rows.js";

const RECENT = 5;
const RX_PAGE = 10;

/** The patient's latest bills, with a way to start a new one and a link to all of them. */
export function BillsPanel({ patientId }: { patientId: PatientId }) {
  const { can } = useClinic();
  const navigate = useNavigate();
  const invoices = useInvoices({ patientId });
  if (!can("billing.read")) {
    return <Empty title="Billing is hidden for your role">Ask the clinic owner if you need to see bills.</Empty>;
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
        <SkeletonRows label="Loading" />
      ) : invoices.isError ? (
        <ApiErrorNotice title="Couldn't load bills" error={invoices.error} onRetry={() => void invoices.refetch()} />
      ) : items.length === 0 ? (
        <Empty title="No bills yet">Bills, payments and dues for this patient will appear here.</Empty>
      ) : (
        <MkCard>
          <ul aria-label="Recent bills" className="flex flex-col gap-2">
            {items.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-2 text-sm">
                <Link href={`/billing/invoices/${i.id}`} className="font-mono text-xs font-semibold text-primary-text hover:underline">
                  {i.number ?? "Draft"}
                </Link>
                <Tag tone={statusTone(i.status === "issued" ? "success" : i.status === "void" ? "danger" : "neutral")}>{i.status}</Tag>
                {i.payment_state == null ? null : <Tag tone={statusTone(i.payment_state === "paid" ? "success" : "warning")}>{i.payment_state}</Tag>}
                <span className="ms-auto font-semibold tabular-nums text-text">{formatRupees(i.total_paise)}</span>
                <span className="text-muted">{formatDate(i.issued_at ?? i.created_at)}</span>
              </li>
            ))}
          </ul>
        </MkCard>
      )}
    </div>
  );
}

/** The patient's prescription history, newest first, ten at a time, with New prescription and Quick Rx. */
export function PrescriptionsPanel({ patientId }: { patientId: PatientId }) {
  const { can } = useClinic();
  const navigate = useNavigate();
  const toast = useToast();
  const prescriptions = usePrescriptions(patientId);
  const last = useLastPrescription(patientId);
  const create = useCreatePrescription(patientId);
  const [shown, setShown] = useState(RX_PAGE);
  const all: readonly Prescription[] = [...(prescriptions.data?.items ?? [])].sort((a, b) => (b.issued_at ?? b.created_at).localeCompare(a.issued_at ?? a.created_at));
  const items = all.slice(0, shown);
  const start = (input: RxValues, failure: string) => {
    create.mutate(input, {
      onSuccess: (draft) => {
        void navigate(`/prescriptions/${draft.id}`);
      },
      onError: () => {
        toast.show({ title: failure, tone: "danger" });
      },
    });
  };
  return (
    <div className="flex flex-col gap-4">
      {can("prescriptions.issue") ? (
        <div className="flex flex-wrap gap-2">
          <Button
            icon={<Plus aria-hidden="true" className="size-4" />}
            disabled={create.isPending}
            onClick={() => {
              start({}, "Couldn't start a prescription.");
            }}
          >
            New prescription
          </Button>
          {last.data === undefined ? null : (
            <Button
              variant="secondary"
              icon={<RotateCw aria-hidden="true" className="size-4" />}
              disabled={create.isPending}
              onClick={() => {
                start({ items: last.data.items, diagnosis_text: last.data.diagnosis_text ?? null, advice: last.data.advice ?? null }, "Couldn't start Quick Rx.");
              }}
            >
              Quick Rx
            </Button>
          )}
        </div>
      ) : null}
      {prescriptions.isPending ? (
        <SkeletonRows label="Loading" />
      ) : prescriptions.isError ? (
        <ApiErrorNotice title="Couldn't load prescriptions" error={prescriptions.error} onRetry={() => void prescriptions.refetch()} />
      ) : items.length === 0 ? (
        <Empty title="No prescriptions yet">Drafts and issued prescriptions will appear here.</Empty>
      ) : (
        <MkCard>
          <ul aria-label="Prescriptions" className="flex flex-col gap-2">
            {items.map((rx) => (
              <li key={rx.id} className="flex flex-wrap items-center gap-2 text-sm">
                <Link href={`/prescriptions/${rx.id}`} className="font-mono text-xs font-semibold text-primary-text hover:underline">
                  {rx.number ?? "Draft"}
                </Link>
                <Tag tone={statusTone(rx.status === "issued" ? "success" : rx.status === "cancelled" ? "danger" : "neutral")}>{rx.status}</Tag>
                <span className="text-muted">{rx.items.map((item) => item.drug_name).join(", ")}</span>
                <span className="ms-auto text-muted">{formatDate(rx.issued_at ?? rx.created_at)}</span>
              </li>
            ))}
          </ul>
          {all.length > shown ? (
            <Button
              variant="secondary"
              onClick={() => {
                setShown((n) => n + RX_PAGE);
              }}
            >
              Load more
            </Button>
          ) : null}
        </MkCard>
      )}
    </div>
  );
}
