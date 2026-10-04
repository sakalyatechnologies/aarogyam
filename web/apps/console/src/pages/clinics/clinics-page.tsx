import { Building2, Plus } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";

import type { ConsoleClinic } from "@aarogyam/api-client";
import { ApiErrorNotice, formatDate, useDocumentTitle } from "@aarogyam/app-kit";
import { Button, Card, DataTable, Field, PageHeader, TextInput, type DataTableColumn } from "@sakalya/ui";

import { useClinics } from "../../api.js";
import { ClinicStatusPill } from "./clinic-status.js";

const COLUMNS: readonly DataTableColumn<ConsoleClinic>[] = [
  { id: "name", header: "Clinic", cell: (row) => <span className="font-semibold">{row.name}</span>, sortValue: (row) => row.name },
  {
    id: "address",
    header: "Address",
    cell: (row) => <span className="font-mono text-xs">{row.slug}.aarogyam.example</span>,
    sortValue: (row) => row.slug,
  },
  { id: "specialty", header: "Specialty", cell: () => "Dental" },
  { id: "status", header: "Status", cell: (row) => <ClinicStatusPill status={row.status} />, sortValue: (row) => row.status },
  { id: "created", header: "Created", align: "end", cell: (row) => formatDate(row.created_at), sortValue: (row) => row.created_at },
];

export function ClinicsPage() {
  useDocumentTitle("Clinics", "Sakalya Console");
  const navigate = useNavigate();
  const clinics = useClinics();
  const [filter, setFilter] = useState("");
  const query = filter.trim().toLowerCase();
  const rows = (clinics.data?.items ?? []).filter(
    (clinic) => query === "" || clinic.name.toLowerCase().includes(query) || clinic.slug.includes(query),
  );
  const newClinic = (
    <Button
      icon={<Plus aria-hidden="true" className="size-4" />}
      onClick={() => {
        void navigate("/clinics/new");
      }}
    >
      New clinic
    </Button>
  );

  return (
    <>
      <PageHeader title="Clinics" subtitle="Every clinic on Aarogyam" end={newClinic} />
      <Card>
        {clinics.isError ? (
          <ApiErrorNotice title="Couldn't load clinics" error={clinics.error} onRetry={() => void clinics.refetch()} />
        ) : (
          <>
            <Field label="Search clinics" hideLabel className="mb-4 max-w-sm">
              <TextInput
                type="search"
                placeholder="Search by name or address"
                value={filter}
                onChange={(event) => {
                  setFilter(event.currentTarget.value);
                }}
              />
            </Field>
            <DataTable
              caption="Clinics"
              columns={COLUMNS}
              rows={rows}
              rowKey={(row) => row.id}
              loading={clinics.isPending}
              defaultSort={{ columnId: "created", direction: "descending" }}
              empty={
                query === ""
                  ? { title: "No clinics yet", description: "Create the first clinic to get started.", icon: <Building2 className="size-7" />, action: newClinic }
                  : { title: "No clinics match", description: "Try another name or address." }
              }
            />
          </>
        )}
      </Card>
    </>
  );
}
