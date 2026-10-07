import { AlertTriangle, CheckCircle2, CopyCheck, FileSpreadsheet, FileUp, ListTodo, XCircle } from "lucide-react";
import { useRef, useState } from "react";
import { Link } from "react-router";

import {
  apiErrorOf,
  importFieldKey,
  type ColumnSuggestion,
  type ImportChoices,
  type ImportFieldKey,
  type ImportSession,
  type RowChoice,
  type SmartImportResult,
  type SmartImportRow,
} from "@aarogyam/api-client";
import { useDocumentTitle } from "@aarogyam/app-kit";
import { Button, Card, DataTable, Field, Pill, RadioGroup, Select, StatCard, TextArea, useToast, type DataTableColumn, type Tone } from "@sakalya/ui";

import { useClinic } from "../../clinic.js";
import { useCommitImport, useDiscardImport, usePreviewImport, useUploadImportFile } from "../../queries.js";
import { EmptyState, PageHeader } from "../../components/mk/index.js";

/** Our fields, as the mapping step names them. */
export const FIELD_LABELS: Readonly<Record<ImportFieldKey, string>> = {
  full_name: "Full name",
  phone: "Phone",
  sex: "Sex",
  date_of_birth: "Date of birth",
  age_years: "Age in years",
  email: "Email",
  address: "Address",
  last_visit: "Last visit",
  file_number: "File number",
  legacy_id: "Old software ID",
  preferred_language: "Preferred language",
  balance: "Balance (not imported)",
};

const MISSING_LABELS: Readonly<Record<string, string>> = { phone: "phone", sex: "sex", date_of_birth: "date of birth" };

/** Column index to our field, or `"none"` for a column left out. */
type Mapping = Record<number, ImportFieldKey | "none">;

function initialMapping(session: ImportSession): Mapping {
  return Object.fromEntries(session.suggestions.map((s) => [s.column, s.field ?? "none"]));
}

function choicesOf(mapping: Mapping, duplicates: "skip" | "merge", rows: Readonly<Record<number, RowChoice>>): ImportChoices {
  const fields: Record<string, number> = {};
  for (const [column, field] of Object.entries(mapping)) {
    if (field !== "none") fields[field] = Number(column);
  }
  return {
    mapping: fields,
    duplicates,
    rows: Object.entries(rows).map(([row, choice]) => ({ row: Number(row), choice })),
  };
}

function confidenceOf(s: ColumnSuggestion): { tone: Tone; label: string } {
  if (s.basis === "saved") return { tone: "success", label: "As last time" };
  if (s.field == null) return { tone: "neutral", label: "Not recognised" };
  if (s.confidence >= 80) return { tone: "success", label: `Sure (${String(s.confidence)}%)` };
  if (s.confidence >= 55) return { tone: "info", label: `Likely (${String(s.confidence)}%)` };
  return { tone: "warning", label: `Please check (${String(s.confidence)}%)` };
}

/** Patients -> Import: upload a CSV or Excel file, check the suggested mapping, preview every row, import, then finish missing details. */
export function ImportPage() {
  const { session, can } = useClinic();
  useDocumentTitle("Import patients", session.clinic.name);
  if (!can("patients.write")) {
    return <EmptyState title="You can't import patients" description="Ask the clinic's owner if you need to." />;
  }
  return <ImportWizard />;
}

function ImportWizard() {
  const toast = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | undefined>(undefined);
  const [pasted, setPasted] = useState("");
  const [session, setSession] = useState<ImportSession | undefined>(undefined);
  const [mapping, setMapping] = useState<Mapping>({});
  const [duplicates, setDuplicates] = useState<"skip" | "merge">("skip");
  const [rowChoices, setRowChoices] = useState<Record<number, RowChoice>>({});
  const [preview, setPreview] = useState<SmartImportResult | undefined>(undefined);
  const [committed, setCommitted] = useState<SmartImportResult | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const upload = useUploadImportFile();
  const previewImport = usePreviewImport();
  const commitImport = useCommitImport();
  const discard = useDiscardImport();

  const fail = (fallback: string) => (thrown: unknown) => {
    setError(apiErrorOf(thrown)?.message ?? fallback);
  };

  const send = (chosen: File, sheet?: string) => {
    setError(undefined);
    const form = new FormData();
    form.append("file", chosen);
    if (sheet !== undefined) form.append("sheet", sheet);
    upload.mutate(form, {
      onSuccess: (opened) => {
        setFile(chosen);
        setSession(opened);
        setMapping(initialMapping(opened));
        setRowChoices({});
        setPreview(undefined);
        setCommitted(undefined);
      },
      onError: fail("Couldn't read that file. Please try again."),
    });
  };

  const runPreview = (nextDuplicates = duplicates, nextRows = rowChoices) => {
    if (session === undefined) return;
    setError(undefined);
    previewImport.mutate(
      { id: session.id, choices: choicesOf(mapping, nextDuplicates, nextRows) },
      { onSuccess: setPreview, onError: fail("Couldn't check that file. Please try again.") },
    );
  };

  const runCommit = () => {
    if (session === undefined) return;
    setError(undefined);
    commitImport.mutate(
      { id: session.id, choices: choicesOf(mapping, duplicates, rowChoices) },
      {
        onSuccess: (result) => {
          setCommitted(result);
          toast.show({
            title: `Imported ${String(result.imported)} patients${result.merged > 0 ? `, merged ${String(result.merged)}` : ""}`,
            tone: result.failed > 0 || result.incomplete > 0 ? "warning" : "success",
          });
        },
        onError: fail("Couldn't import that file. Please try again."),
      },
    );
  };

  const startOver = () => {
    if (session !== undefined && committed === undefined) discard.mutate(session.id);
    setFile(undefined);
    setSession(undefined);
    setPreview(undefined);
    setCommitted(undefined);
    setPasted("");
    setError(undefined);
  };

  const nameMapped = Object.values(mapping).includes("full_name");
  const chosenFields = new Set(Object.values(mapping));

  return (
    <>
      <PageHeader
        title="Import patients"
        subtitle="Your own spreadsheet, in whatever layout you have: CSV or Excel (.xlsx), up to 5,000 rows and 5 MB."
      />
      <div className="flex flex-col gap-4">
        <Card title="1. Upload">
          {session === undefined ? (
            <div className="flex flex-col gap-4">
              <input
                ref={fileInput}
                type="file"
                aria-label="Patient file"
                accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className="hidden"
                onChange={(event) => {
                  const chosen = event.target.files?.[0];
                  if (chosen !== undefined) send(chosen);
                }}
              />
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  variant="secondary"
                  icon={<FileUp aria-hidden="true" className="size-4" />}
                  disabled={upload.isPending}
                  onClick={() => {
                    fileInput.current?.click();
                  }}
                >
                  {upload.isPending ? "Reading…" : "Choose a file"}
                </Button>
                <p className="text-sm text-muted">Columns are matched automatically; you check them next.</p>
              </div>
              <Field label="Or paste CSV text" hint="The first line is the header.">
                <TextArea
                  rows={4}
                  value={pasted}
                  placeholder="Name,Mobile,Gender&#10;Asha Rane,9876543210,F"
                  onChange={(event) => {
                    setPasted(event.target.value);
                  }}
                />
              </Field>
              <div className="flex justify-end">
                <Button
                  variant="secondary"
                  disabled={pasted.trim() === "" || upload.isPending}
                  onClick={() => {
                    send(new File([pasted], "pasted.csv", { type: "text/csv" }));
                  }}
                >
                  Use pasted text
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <FileSpreadsheet aria-hidden="true" className="size-5 text-muted" />
              <span className="font-medium">{session.file_name}</span>
              <span className="text-muted">
                {String(session.row_count)} rows, headers on row {String(session.header_row)}
              </span>
              {session.sheets.length > 1 && file !== undefined && committed === undefined ? (
                <Field label="Sheet" hideLabel>
                  <Select
                    aria-label="Sheet"
                    options={session.sheets.map((s) => ({ value: s, label: s }))}
                    value={session.sheet ?? ""}
                    onValueChange={(sheet) => {
                      discard.mutate(session.id);
                      send(file, sheet);
                    }}
                  />
                </Field>
              ) : null}
              <Button variant="ghost" onClick={startOver}>
                {committed === undefined ? "Start over" : "Import another file"}
              </Button>
            </div>
          )}
        </Card>

        {error === undefined ? null : (
          <p role="alert" className="rounded-xl bg-danger-soft px-4 py-3 text-sm font-medium text-danger-text">
            {error}
          </p>
        )}

        {session === undefined || committed !== undefined ? null : (
          <Card title="2. Check the columns">
            <p className="mb-3 text-sm text-muted">We matched your columns from their names and contents. Change any that are wrong; we'll remember your choices for next time.</p>
            <div className="flex flex-col divide-y divide-border">
              {session.suggestions.map((s) => {
                const confidence = confidenceOf(s);
                const samples = session.sample
                  .map((row) => row[s.column] ?? "")
                  .filter((v) => v !== "")
                  .slice(0, 3);
                const current = mapping[s.column] ?? "none";
                return (
                  <div key={s.column} className="grid gap-2 py-3 sm:grid-cols-[1fr_1fr_auto] sm:items-center">
                    <div>
                      <p className="font-medium">{s.header}</p>
                      <p className="truncate text-xs text-muted">{samples.length === 0 ? "No values in the first rows" : samples.join(" · ")}</p>
                    </div>
                    <Field label={`Field for ${s.header}`} hideLabel>
                      <Select<ImportFieldKey | "none">
                        options={[
                          { value: "none", label: "Don't import" },
                          ...importFieldKey.options
                            .filter((key) => key === current || !chosenFields.has(key))
                            .map((key) => ({ value: key, label: FIELD_LABELS[key] })),
                        ]}
                        value={current}
                        onValueChange={(value) => {
                          setMapping((prev) => ({ ...prev, [s.column]: value }));
                          setPreview(undefined);
                        }}
                      />
                    </Field>
                    <Pill tone={current === s.field || (current === "none" && s.field == null) ? confidence.tone : "primary"}>
                      {current === s.field || (current === "none" && s.field == null) ? confidence.label : "Your choice"}
                    </Pill>
                  </div>
                );
              })}
            </div>
            <div className="mt-4 flex items-center justify-end gap-3">
              {nameMapped ? null : <p className="text-sm text-warning-text">Choose the column with the patient's name.</p>}
              <Button
                disabled={!nameMapped || previewImport.isPending}
                onClick={() => {
                  runPreview();
                }}
              >
                {previewImport.isPending ? "Checking…" : "Preview"}
              </Button>
            </div>
          </Card>
        )}

        {preview === undefined || committed !== undefined ? null : (
          <PreviewStep
            preview={preview}
            duplicates={duplicates}
            rowChoices={rowChoices}
            busy={previewImport.isPending || commitImport.isPending}
            onDuplicates={(value) => {
              setDuplicates(value);
              runPreview(value, rowChoices);
            }}
            onRowChoice={(row, choice) => {
              const next = { ...rowChoices, [row]: choice };
              setRowChoices(next);
              runPreview(duplicates, next);
            }}
            onCommit={runCommit}
          />
        )}

        {committed === undefined ? null : <DoneStep result={committed} />}
      </div>
    </>
  );
}

function statusOf(row: SmartImportRow): { tone: Tone; label: string } {
  switch (row.action) {
    case "import":
      return row.missing.length > 0 ? { tone: "warning", label: "New, incomplete" } : { tone: "success", label: "New" };
    case "imported":
      return row.missing.length > 0 ? { tone: "warning", label: `Imported as ${row.number ?? ""}, incomplete` } : { tone: "success", label: `Imported as ${row.number ?? ""}` };
    case "merge":
      return { tone: "info", label: "Merge" };
    case "merged":
      return { tone: "info", label: `Merged into ${row.number ?? ""}` };
    case "skip":
    case "skipped":
      return { tone: "neutral", label: row.action === "skip" ? "Skip" : "Skipped" };
    default:
      return { tone: "danger", label: row.action === "fail" ? "Can't import" : "Not imported" };
  }
}

function details(row: SmartImportRow): string {
  const parts: string[] = [];
  if (row.duplicate_of != null) {
    parts.push(row.duplicate_of.number == null ? `Same phone and name as row ${String(row.duplicate_of.row ?? "")}` : `Same phone and name as ${row.duplicate_of.number}`);
  }
  if (row.missing.length > 0) parts.push(`Missing ${row.missing.map((m) => MISSING_LABELS[m] ?? m).join(", ")}`);
  parts.push(...row.errors.filter((e) => !e.startsWith("same phone")), ...row.warnings);
  return parts.length === 0 ? "—" : parts.join("; ");
}

interface PreviewStepProps {
  preview: SmartImportResult;
  duplicates: "skip" | "merge";
  rowChoices: Readonly<Record<number, RowChoice>>;
  busy: boolean;
  onDuplicates: (value: "skip" | "merge") => void;
  onRowChoice: (row: number, choice: RowChoice) => void;
  onCommit: () => void;
}

function PreviewStep({ preview, duplicates, rowChoices, busy, onDuplicates, onRowChoice, onCommit }: PreviewStepProps) {
  const duplicateCount = preview.rows.filter((r) => r.duplicate_of != null).length;
  const columns: readonly DataTableColumn<SmartImportRow>[] = [
    { id: "row", header: "Row", cell: (r) => String(r.row) },
    { id: "name", header: "Name", cell: (r) => r.values.full_name ?? "—" },
    { id: "phone", header: "Phone", cell: (r) => r.values.phone ?? "—" },
    {
      id: "status",
      header: "Result",
      cell: (r) => {
        const status = statusOf(r);
        return <Pill tone={status.tone}>{status.label}</Pill>;
      },
    },
    { id: "details", header: "Details", cell: details },
    {
      id: "choice",
      header: "Choice",
      cell: (r) =>
        r.duplicate_of == null ? null : (
          <Select<RowChoice>
            aria-label={`Choice for row ${String(r.row)}`}
            options={[
              { value: "skip", label: "Skip" },
              { value: "merge", label: "Merge" },
              { value: "import", label: "Import as new" },
            ]}
            value={rowChoices[r.row] ?? duplicates}
            onValueChange={(choice) => {
              onRowChoice(r.row, choice);
            }}
          />
        ),
    },
  ];
  return (
    <>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="New patients" value={String(preview.imported)} tone="success" icon={<CheckCircle2 className="size-7" />} />
        <StatCard label="Missing details" value={String(preview.incomplete)} tone={preview.incomplete > 0 ? "warning" : "primary"} icon={<AlertTriangle className="size-7" />} />
        <StatCard label="Duplicates" value={String(duplicateCount)} tone="primary" icon={<CopyCheck className="size-7" />} />
        <StatCard label="Can't import" value={String(preview.failed)} tone={preview.failed > 0 ? "danger" : "primary"} icon={<XCircle className="size-7" />} />
      </div>
      <Card title="3. Preview">
        <div className="flex flex-col gap-4">
          {preview.notes.map((note) => (
            <p key={note} className="text-sm text-muted">
              {note}
            </p>
          ))}
          {duplicateCount === 0 ? null : (
            <RadioGroup<"skip" | "merge">
              label="Rows with the same phone and name as an existing patient or an earlier row"
              orientation="horizontal"
              options={[
                { value: "skip", label: "Skip them" },
                { value: "merge", label: "Merge: fill only empty details" },
              ]}
              value={duplicates}
              onValueChange={onDuplicates}
            />
          )}
          <p className="text-sm text-muted">Nothing is guessed: values we can't read are left empty, and patients missing details go on a to-do list for the front desk.</p>
          <DataTable caption="Import preview" columns={columns} rows={preview.rows} rowKey={(r) => String(r.row)} pageSize={25} />
          <div className="flex justify-end">
            <Button disabled={preview.imported + preview.merged === 0 || busy} onClick={onCommit}>
              {busy ? "Working…" : `4. Import ${String(preview.imported)} patients${preview.merged > 0 ? ` and merge ${String(preview.merged)}` : ""}`}
            </Button>
          </div>
        </div>
      </Card>
    </>
  );
}

function DoneStep({ result }: { result: SmartImportResult }) {
  const columns: readonly DataTableColumn<SmartImportRow>[] = [
    { id: "row", header: "Row", cell: (r) => String(r.row) },
    {
      id: "status",
      header: "Result",
      cell: (r) => {
        const status = statusOf(r);
        return <Pill tone={status.tone}>{status.label}</Pill>;
      },
    },
    { id: "details", header: "Details", cell: details },
  ];
  return (
    <Card title="Imported">
      <div className="flex flex-col gap-4">
        <p className="text-sm">
          {String(result.imported)} new patients, {String(result.merged)} merged, {String(result.skipped)} skipped, {String(result.failed)} not imported.
        </p>
        {result.incomplete > 0 ? (
          <div className="flex flex-wrap items-center gap-3 rounded-xl bg-warning-soft px-4 py-3 text-sm">
            <ListTodo aria-hidden="true" className="size-5" />
            <span>{String(result.incomplete)} patients are missing details.</span>
            <Link to="/patients/incomplete" className="font-semibold underline">
              Finish missing details
            </Link>
          </div>
        ) : null}
        <DataTable caption="Import result" columns={columns} rows={result.rows} rowKey={(r) => String(r.row)} pageSize={25} />
        <div className="flex justify-end">
          <Link to="/patients" className="text-sm font-semibold underline">
            Go to patients
          </Link>
        </div>
      </div>
    </Card>
  );
}
