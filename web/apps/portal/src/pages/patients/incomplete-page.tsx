import { Link } from "react-router";

import { apiErrorOf, type IncompletePatient } from "@aarogyam/api-client";
import { useDocumentTitle } from "@aarogyam/app-kit";
import { Button, Card, DataTable, EmptyState, PageHeader, Pill, useToast, type DataTableColumn } from "@sakalya/ui";

import { useClinic } from "../../clinic.js";
import { useDismissIncomplete, useIncompletePatients } from "../../queries.js";

const MISSING_LABELS: Readonly<Record<string, string>> = { phone: "Phone", sex: "Sex", date_of_birth: "Date of birth" };

/** Patients -> Missing details: imported patients the front desk still has to complete. */
export function IncompletePage() {
  const { session, can } = useClinic();
  useDocumentTitle("Missing details", session.clinic.name);
  if (!can("patients.read")) {
    return <EmptyState title="You can't see patients" description="Ask the clinic's owner if you need to." />;
  }
  return <IncompleteList canEdit={can("patients.write")} />;
}

function IncompleteList({ canEdit }: { canEdit: boolean }) {
  const toast = useToast();
  const list = useIncompletePatients();
  const dismiss = useDismissIncomplete();
  const columns: DataTableColumn<IncompletePatient>[] = [
    {
      id: "patient",
      header: "Patient",
      cell: (p) => (
        <Link to={`/patients/${p.patient_id}`} className="font-medium underline-offset-2 hover:underline">
          {p.full_name} <span className="text-muted">{p.number}</span>
        </Link>
      ),
    },
    {
      id: "missing",
      header: "Missing",
      cell: (p) => (
        <span className="flex flex-wrap gap-1">
          {p.missing.map((m) => (
            <Pill key={m} tone="warning">
              {MISSING_LABELS[m] ?? m}
            </Pill>
          ))}
        </span>
      ),
    },
    {
      id: "source",
      header: "From",
      cell: (p) => [p.file_name, p.sheet, `row ${String(p.row)}`].filter((part) => part != null && part !== "").join(" · "),
    },
  ];
  if (canEdit) {
    columns.push({
      id: "actions",
      header: "Actions",
      cell: (p) => (
        <span className="flex flex-wrap gap-2">
          <Link to={`/patients/${p.patient_id}/edit`} className="text-sm font-semibold underline">
            Fill in
          </Link>
          <Button
            variant="ghost"
            disabled={dismiss.isPending}
            onClick={() => {
              dismiss.mutate(p.id, {
                onError: (thrown) => {
                  toast.show({ title: apiErrorOf(thrown)?.message ?? "Couldn't update the list.", tone: "danger" });
                },
              });
            }}
          >
            Can't get these
          </Button>
        </span>
      ),
    });
  }
  return (
    <>
      <PageHeader title="Missing details" subtitle="Patients imported without a phone, sex or date of birth. Filling a detail takes them off this list." />
      <Card>
        <DataTable
          caption="Patients missing details"
          columns={columns}
          rows={list.data?.items ?? []}
          rowKey={(p) => p.id}
          loading={list.isPending}
          empty={{ title: "Nothing to finish", description: "Every imported patient has their details." }}
          pageSize={25}
        />
      </Card>
    </>
  );
}
