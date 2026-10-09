import { Link } from "react-router";

import { apiErrorOf, type IncompletePatient } from "@aarogyam/api-client";
import { useDocumentTitle } from "@aarogyam/app-kit";
import { Button, Card, DataTable, Pill, useToast, type DataTableColumn } from "@sakalya/ui";

import { useClinic } from "../../clinic.js";
import { useDismissIncomplete, useIncompletePatients } from "../../queries.js";
import { EmptyState, PageHeader } from "../../components/mk/index.js";

const MISSING_LABELS: Readonly<Record<string, string>> = { phone: "Phone", sex: "Sex", date_of_birth: "Age" };

/** Patients -> Missing details: imported patients, and patients registered with no age or sex, still to complete. */
export function IncompletePage() {
  const { session, can } = useClinic();
  useDocumentTitle("Missing details", session.clinic.name);
  if (!can("patients.read")) {
    return <EmptyState title="You can't see patients" description="Ask the clinic's owner if you need to." />;
  }
  return <IncompleteList canEdit={can("patients.write")} />;
}

function IncompleteList({ canEdit }: { canEdit: boolean }) {
  const list = useIncompletePatients();
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
      cell: (p) =>
        p.id == null ? "Registered here" : [p.file_name, p.sheet, p.row == null ? null : `row ${String(p.row)}`].filter((part) => part != null && part !== "").join(" · "),
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
          {p.id == null ? null : <DismissButton id={p.id} />}
        </span>
      ),
    });
  }
  return <IncompleteTable columns={columns} rows={list.data?.items ?? []} loading={list.isPending} />;
}

function DismissButton({ id }: { id: NonNullable<IncompletePatient["id"]> }) {
  const toast = useToast();
  const dismiss = useDismissIncomplete();
  return (
    <Button
      variant="ghost"
      disabled={dismiss.isPending}
      onClick={() => {
        dismiss.mutate(id, {
          onError: (thrown) => {
            toast.show({ title: apiErrorOf(thrown)?.message ?? "Couldn't update the list.", tone: "danger" });
          },
        });
      }}
    >
      Can't get these
    </Button>
  );
}

function IncompleteTable({ columns, rows, loading }: { columns: DataTableColumn<IncompletePatient>[]; rows: readonly IncompletePatient[]; loading: boolean }) {
  return (
    <>
      <PageHeader
        title="Missing details"
        subtitle="Imported patients without a phone, sex or age, and patients registered without an age or sex. Filling a detail takes them off this list."
      />
      <Card>
        <DataTable
          caption="Patients missing details"
          columns={columns}
          rows={rows}
          rowKey={(p) => p.id ?? p.patient_id}
          loading={loading}
          empty={{ title: "Nothing to finish", description: "Every patient has a sex and an age, and every imported patient a phone." }}
          pageSize={25}
        />
      </Card>
    </>
  );
}
