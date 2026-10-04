import { Pill as PillIcon, Plus, RotateCw } from "lucide-react";
import { useNavigate, useParams } from "react-router";

import { patientId as patientIdSchema, type Prescription } from "@aarogyam/api-client";
import { ApiErrorNotice, formatDate, useDocumentTitle } from "@aarogyam/app-kit";
import { Button, Card, DataTable, Link, PageHeader, Pill, useToast, type DataTableColumn } from "@sakalya/ui";

import { usePatient } from "../../queries.js";
import { useCreatePrescription, useLastPrescription, usePrescriptions } from "./queries.js";

function statusTone(status: string): "neutral" | "success" | "danger" {
  return status === "issued" ? "success" : status === "cancelled" ? "danger" : "neutral";
}

/** A patient's prescriptions: issue a new one, repeat the last with Quick Rx, or open an existing draft. */
export function PatientPrescriptionsPage() {
  const navigate = useNavigate();
  const params = useParams();
  const parsed = patientIdSchema.safeParse(params.patientId);
  const patientId = parsed.success ? parsed.data : undefined;
  const patient = usePatient(patientId);
  const prescriptions = usePrescriptions(patientId);
  const last = useLastPrescription(patientId);
  const create = useCreatePrescription(patientId);
  const toast = useToast();
  useDocumentTitle("Prescriptions", patient.data?.full_name ?? "Aarogyam");

  if (patientId === undefined) {
    return <ApiErrorNotice title="That patient address isn't valid" error={{ status: 404, code: "not_found", message: "No such patient." }} />;
  }

  const columns: readonly DataTableColumn<Prescription>[] = [
    {
      id: "number",
      header: "Number",
      cell: (rx) => (
        <Link href={`/prescriptions/${rx.id}`} className="font-mono text-xs font-semibold text-primary-text hover:underline">
          {rx.number ?? "Draft"}
        </Link>
      ),
      sortValue: (rx) => rx.number ?? rx.created_at,
    },
    { id: "status", header: "Status", cell: (rx) => <Pill tone={statusTone(rx.status)}>{rx.status}</Pill> },
    { id: "items", header: "Medicines", cell: (rx) => rx.items.map((item) => item.drug_name).join(", ") },
    { id: "date", header: "Date", align: "end", cell: (rx) => formatDate(rx.issued_at ?? rx.created_at), sortValue: (rx) => rx.issued_at ?? rx.created_at },
  ];

  return (
    <>
      <PageHeader
        title="Prescriptions"
        {...(patient.data === undefined ? {} : { subtitle: `${patient.data.full_name} · ${patient.data.number}` })}
        end={
          <div className="flex gap-2">
            {last.data === undefined ? null : (
              <Button
                variant="secondary"
                icon={<RotateCw aria-hidden="true" className="size-4" />}
                disabled={create.isPending}
                onClick={() => {
                  create.mutate(
                    {
                      items: last.data.items,
                      diagnosis_text: last.data.diagnosis_text ?? null,
                      advice: last.data.advice ?? null,
                    },
                    {
                      onSuccess: (draft) => {
                        void navigate(`/prescriptions/${draft.id}`);
                      },
                      onError: () => {
                        toast.show({ title: "Couldn't start Quick Rx.", tone: "danger" });
                      },
                    },
                  );
                }}
              >
                Quick Rx
              </Button>
            )}
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
          </div>
        }
      />
      <Card>
        {prescriptions.isError ? (
          <ApiErrorNotice title="Couldn't load prescriptions" error={prescriptions.error} onRetry={() => void prescriptions.refetch()} />
        ) : (
          <DataTable
            caption="Prescriptions"
            columns={columns}
            rows={prescriptions.data?.items ?? []}
            rowKey={(rx) => rx.id}
            loading={prescriptions.isPending}
            defaultSort={{ columnId: "date", direction: "descending" }}
            empty={{ title: "No prescriptions yet", description: "Issue the first one to see it here.", icon: <PillIcon className="size-7" /> }}
          />
        )}
      </Card>
    </>
  );
}
