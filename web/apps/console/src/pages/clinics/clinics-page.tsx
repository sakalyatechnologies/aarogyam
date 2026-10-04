import { Building2, Plus } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";

import type { ConsoleClinic } from "@aarogyam/api-client";
import { ApiErrorNotice, formatDate, formatNumber, useDocumentTitle } from "@aarogyam/app-kit";
import { Button, Card, DataTable, Field, Link, PageHeader, TextInput, type DataTableColumn } from "@sakalya/ui";

import { useClinics } from "../../api.js";
import { ClinicStatusPill } from "./clinic-status.js";

const COLUMNS: readonly DataTableColumn<ConsoleClinic>[] = [
  {
    id: "name",
    header: "Clinic",
    cell: (row) => (
      <Link href={`/clinics/${row.id}`} className="font-semibold text-text hover:underline">
        {row.name}
      </Link>
    ),
    sortValue: (row) => row.name,
  },
  {
    id: "address",
    header: "Portal",
    cell: (row) => <span className="font-mono text-xs">{row.portal_host ?? `${row.slug} (no host yet)`}</span>,
    sortValue: (row) => row.slug,
  },
  { id: "specialty", header: "Specialty", cell: (row) => (row.specialty === "dental" ? "Dental" : row.specialty) },
  { id: "members", header: "Staff", align: "end", cell: (row) => formatNumber(row.active_members), sortValue: (row) => row.active_members },
  { id: "patients", header: "Patients", align: "end", cell: (row) => formatNumber(row.patients), sortValue: (row) => row.patients },
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
    (clinic) => query === "" || clinic.name.toLowerCase().includes(query) || clinic.slug.includes(query) || (clinic.portal_host ?? "").includes(query),
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
