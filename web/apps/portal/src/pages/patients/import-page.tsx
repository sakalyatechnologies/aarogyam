import { CheckCircle2, FileSpreadsheet, FileUp, XCircle } from "lucide-react";
import { useRef, useState } from "react";
import { useNavigate } from "react-router";

import { apiErrorOf, type ImportResult } from "@aarogyam/api-client";
import { useDocumentTitle } from "@aarogyam/app-kit";
import { Button, Card, DataTable, EmptyState, Field, PageHeader, Pill, Select, StatCard, TextArea, useToast, type DataTableColumn } from "@sakalya/ui";

import { useClinic } from "../../clinic.js";
import { useImportPatients } from "../../queries.js";

interface ImportField {
  key: string;
  label: string;
  required: boolean;
}

/** Our fields, in the order shown; `full_name` is the only one the API requires. */
const FIELDS: readonly ImportField[] = [
  { key: "full_name", label: "Full name", required: true },
  { key: "sex", label: "Sex", required: false },
  { key: "date_of_birth", label: "Date of birth", required: false },
  { key: "age_years", label: "Age in years", required: false },
  { key: "phone", label: "Phone", required: false },
  { key: "email", label: "Email", required: false },
  { key: "preferred_language", label: "Preferred language", required: false },
  { key: "file_number", label: "File number", required: false },
  { key: "legacy_id", label: "Legacy ID", required: false },
];

/** Splits the first line of a CSV into column headers. A rough parse for mapping only; the API parses the file itself. */
function headerColumns(csv: string): string[] {
  const first = csv.split(/\r?\n/)[0] ?? "";
  return first
    .split(",")
    .map((cell) => cell.trim().replace(/^"|"$/g, ""))
    .filter((cell) => cell !== "");
}

/** Patients -> Import: upload a CSV, map its columns, preview every row, then commit the valid ones. */
export function ImportPage() {
  const { session, can } = useClinic();
  useDocumentTitle("Import patients", session.clinic.name);
  if (!can("patients.write")) {
    return <EmptyState title="You can't import patients" description="Ask the clinic's owner if you need to." />;
  }
  return <ImportFlow />;
}

function ImportFlow() {
  const navigate = useNavigate();
  const toast = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const [csv, setCsv] = useState("");
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<ImportResult | undefined>(undefined);
  const [committed, setCommitted] = useState<ImportResult | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const importPatients = useImportPatients();

  const columns = headerColumns(csv);
  const canPreview = csv.trim() !== "" && mapping.full_name !== undefined && mapping.full_name !== "";

  const onFile = (file: File | undefined) => {
    if (file === undefined) {
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === "string" ? reader.result : "";
      setCsv(text);
      setMapping({});
      setPreview(undefined);
    };
    reader.readAsText(file);
  };

  const runPreview = () => {
    setError(undefined);
    importPatients.mutate(
      { csv, mapping, mode: "preview" },
      {
        onSuccess: (result) => {
          setPreview(result);
        },
        onError: (thrown) => {
          setError(apiErrorOf(thrown)?.message ?? "Couldn't check that file. Please try again.");
        },
      },
    );
  };

  const runCommit = () => {
    setError(undefined);
    importPatients.mutate(
      { csv, mapping, mode: "commit" },
      {
        onSuccess: (result) => {
          setCommitted(result);
          toast.show({ title: `Imported ${String(result.valid)} of ${String(result.total)} patients`, tone: result.invalid > 0 ? "warning" : "success" });
        },
        onError: (thrown) => {
          setError(apiErrorOf(thrown)?.message ?? "Couldn't import that file. Please try again.");
        },
      },
    );
  };

  const rowColumns: readonly DataTableColumn<ImportResult["rows"][number]>[] = [
    { id: "line", header: "Line", cell: (r) => String(r.line) },
    {
      id: "status",
      header: "Status",
      cell: (r) =>
        r.valid ? (
          <Pill tone="success" icon={<CheckCircle2 aria-hidden="true" className="size-3.5" />}>
            {committed === undefined ? "Valid" : `Imported${r.number == null ? "" : ` as ${r.number}`}`}
          </Pill>
        ) : (
          <Pill tone="danger" icon={<XCircle aria-hidden="true" className="size-3.5" />}>
            Invalid
          </Pill>
        ),
    },
    { id: "errors", header: "Problems", cell: (r) => (r.errors.length === 0 ? "—" : r.errors.join("; ")) },
  ];

  const result = committed ?? preview;

  return (
    <>
      <PageHeader title="Import patients" subtitle="CSV only, up to 5,000 rows and 2 MB." />
      <div className="flex flex-col gap-4">
        <Card title="1. Upload">
          <div className="flex flex-col gap-4">
            <input
              ref={fileInput}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(event) => {
                onFile(event.target.files?.[0]);
              }}
            />
            <div className="flex flex-wrap items-center gap-3">
              <Button
                variant="secondary"
                icon={<FileUp aria-hidden="true" className="size-4" />}
                onClick={() => {
                  fileInput.current?.click();
                }}
              >
                Choose a CSV file
              </Button>
              <p className="text-sm text-muted">{columns.length === 0 ? "No file chosen yet." : `${String(columns.length)} columns found.`}</p>
            </div>
            <Field label="Or paste CSV text" hideLabel hint="The first line is the header.">
              <TextArea
                rows={6}
                value={csv}
                placeholder="full_name,sex,phone&#10;Asha Rane,female,9876543210"
                onChange={(event) => {
                  setCsv(event.target.value);
                  setMapping({});
                  setPreview(undefined);
                }}
              />
            </Field>
          </div>
        </Card>

        {columns.length === 0 ? null : (
          <Card title="2. Match columns">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {FIELDS.map((field) => (
                <Field key={field.key} label={field.label} required={field.required}>
                  <Select
                    options={columns.map((c) => ({ value: c, label: c }))}
                    value={mapping[field.key] ?? ""}
                    onValueChange={(value) => {
                      setMapping((prev) => ({ ...prev, [field.key]: value }));
                    }}
                    placeholder="Not in this file"
                  />
                </Field>
              ))}
            </div>
            <div className="mt-4 flex justify-end">
              <Button disabled={!canPreview || importPatients.isPending} onClick={runPreview}>
                {importPatients.isPending && preview === undefined ? "Checking…" : "Preview"}
              </Button>
            </div>
          </Card>
        )}

        {error === undefined ? null : (
          <p role="alert" className="rounded-xl bg-danger-soft px-4 py-3 text-sm font-medium text-danger-text">
            {error}
          </p>
        )}

        {result === undefined ? null : (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <StatCard label="Rows read" value={String(result.total)} icon={<FileSpreadsheet className="size-7" />} />
              <StatCard label="Valid" value={String(result.valid)} tone="success" icon={<CheckCircle2 className="size-7" />} />
              <StatCard label="Invalid" value={String(result.invalid)} tone={result.invalid > 0 ? "danger" : "primary"} icon={<XCircle className="size-7" />} />
            </div>
            <Card title={committed === undefined ? "3. Preview" : "Imported"}>
              <DataTable caption="Import preview" columns={rowColumns} rows={result.rows} rowKey={(r) => String(r.line)} pageSize={20} />
              <div className="mt-4 flex justify-end gap-2">
                {committed === undefined ? (
                  <Button disabled={result.valid === 0 || importPatients.isPending} onClick={runCommit}>
                    {importPatients.isPending ? "Importing…" : `Import ${String(result.valid)} patients`}
                  </Button>
                ) : (
                  <Button
                    onClick={() => {
                      void navigate("/patients");
                    }}
                  >
                    Go to patients
                  </Button>
                )}
              </div>
            </Card>
          </>
        )}
      </div>
    </>
  );
}
