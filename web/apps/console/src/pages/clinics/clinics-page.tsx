import { Building2, Plus } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";

import type { ConsoleClinic } from "@aarogyam/api-client";
import { ApiErrorNotice, formatDate, formatNumber, useDocumentTitle } from "@aarogyam/app-kit";
import { Button, Card, ChipFilterGroup, DataTable, Link, PageHeader, SearchInput, Select, type DataTableColumn } from "@sakalya/ui";

import { useClinics } from "../../api.js";
import { Tile } from "../../ui/tile.js";
import { ClinicStatusPill } from "./clinic-status.js";
import { countClinics, filterClinics, type ClinicSpecialtyFilter, type ClinicStatusFilter } from "./clinics-view.js";

const COLUMNS: readonly DataTableColumn<ConsoleClinic>[] = [
  {
    id: "name",
    header: "Clinic",
    cell: (row) => (
      <span className="flex flex-col">
        <Link href={`/clinics/${row.id}`} className="font-semibold text-text hover:underline">
          {row.name}
        </Link>
        <span className="font-mono text-xs text-muted">{row.portal_host ?? `${row.slug} (no host yet)`}</span>
      </span>
    ),
    sortValue: (row) => row.name,
  },
  { id: "specialty", header: "Specialty", cell: (row) => (row.specialty === "dental" ? "Dental" : row.specialty === "general" ? "General practice" : row.specialty), sortValue: (row) => row.specialty },
  { id: "members", header: "Staff", align: "end", cell: (row) => formatNumber(row.active_members), sortValue: (row) => row.active_members },
  { id: "patients", header: "Patients", align: "end", cell: (row) => formatNumber(row.patients), sortValue: (row) => row.patients },
  { id: "status", header: "Status", cell: (row) => <ClinicStatusPill status={row.status} />, sortValue: (row) => row.status },
  { id: "created", header: "Created", align: "end", cell: (row) => formatDate(row.created_at), sortValue: (row) => row.created_at },
];

const SPECIALTIES = [
  { value: "all", label: "All specialties" },
  { value: "dental", label: "Dental" },
  { value: "general", label: "General practice" },
] as const;

export function ClinicsPage() {
  useDocumentTitle("Clinics", "Sakalya Console");
  const navigate = useNavigate();
  const clinics = useClinics();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<ClinicStatusFilter>("all");
  const [specialty, setSpecialty] = useState<ClinicSpecialtyFilter>("all");
  const items = clinics.data?.items ?? [];
  const counts = countClinics(items);
  const rows = filterClinics(items, { status, specialty, query });
  const filtered = status !== "all" || specialty !== "all" || query.trim() !== "";
  const patients = items.reduce((sum, clinic) => sum + clinic.patients, 0);
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
      <div className="mb-4 grid grid-cols-2 gap-4 xl:grid-cols-4">
        <Tile label="Clinics" value={counts.all} tone="info" note={`${formatNumber(patients)} patients in total`} />
        <Tile label="Active" value={counts.active} tone="success" />
        <Tile label="On trial" value={counts.trial} note="Not yet on a paid plan" />
        <Tile label="Suspended or churned" value={counts.suspended + counts.churned} tone={counts.suspended > 0 ? "warning" : "neutral"} />
      </div>
      <Card>
        {clinics.isError ? (
          <ApiErrorNotice title="Couldn't load clinics" error={clinics.error} onRetry={() => void clinics.refetch()} />
        ) : (
          <>
            <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <ChipFilterGroup
                label="Filter clinics by status"
                options={[
                  { value: "all", label: `All (${String(counts.all)})` },
                  { value: "active", label: `Active (${String(counts.active)})` },
                  { value: "trial", label: `Trial (${String(counts.trial)})` },
                  { value: "suspended", label: `Suspended (${String(counts.suspended)})` },
                  { value: "churned", label: `Churned (${String(counts.churned)})` },
                ]}
                value={[status]}
                onValueChange={(value) => {
                  setStatus(value[0] ?? "all");
                }}
              />
              <div className="flex flex-col gap-2 sm:flex-row">
                <SearchInput label="Search clinics" placeholder="Name or address" value={query} onValueChange={setQuery} className="sm:w-64" />
                <Select options={SPECIALTIES} value={specialty} onValueChange={setSpecialty} aria-label="Filter by specialty" />
              </div>
            </div>
            <p role="status" className="mb-2 text-xs text-muted">
              {clinics.isPending ? "Loading…" : `Showing ${String(rows.length)} of ${String(counts.all)} clinics`}
            </p>
            <DataTable
              caption="Clinics"
              columns={COLUMNS}
              rows={rows}
              rowKey={(row) => row.id}
              loading={clinics.isPending}
              defaultSort={{ columnId: "created", direction: "descending" }}
              empty={
                filtered
                  ? { title: "No clinics match", description: "Try another status, specialty, name or address." }
                  : { title: "No clinics yet", description: "Create the first clinic to get started.", icon: <Building2 className="size-7" />, action: newClinic }
              }
            />
          </>
        )}
      </Card>
    </>
  );
}
