import { useRef, useState } from "react";

import { apiErrorOf, type StockImportPreview, type StockImportResult } from "@aarogyam/api-client";
import { formatNumber } from "@aarogyam/app-kit";
import { Button, Dialog, Field } from "@sakalya/ui";

import { useCommitStockImport, usePreviewStockImport } from "./order-queries.js";

/**
 * Loads a clinic's stock list from a CSV or Excel file: the file is checked row by row and shown (valid rows, the row
 * errors), and only "Import" commits it. Needs `inventory.manage`.
 */
export function ImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const preview = usePreviewStockImport();
  const commit = useCommitStockImport();
  const [checked, setChecked] = useState<StockImportPreview>();
  const [result, setResult] = useState<StockImportResult>();
  const [error, setError] = useState<string>();
  const input = useRef<HTMLInputElement>(null);

  const close = () => {
    onClose();
    setChecked(undefined);
    setResult(undefined);
    setError(undefined);
    preview.reset();
    commit.reset();
  };

  const check = (file: File | undefined) => {
    setError(undefined);
    setChecked(undefined);
    if (file === undefined) return;
    const form = new FormData();
    form.set("file", file);
    preview.mutate(form, {
      onSuccess: setChecked,
      onError: (thrown) => {
        setError(apiErrorOf(thrown)?.message ?? "Couldn't read this file. Check it is a CSV or Excel list.");
      },
    });
  };

  const apply = () => {
    if (checked === undefined) return;
    setError(undefined);
    commit.mutate(
      { token: checked.token },
      {
        onSuccess: setResult,
        onError: (thrown) => {
          setError(apiErrorOf(thrown)?.message ?? "Couldn't import this list. Please try again.");
        },
      },
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
      title="Import stock"
      description="Items and opening stock from a CSV or Excel file. Nothing changes until you import."
      size="lg"
      footer={
        result === undefined ? (
          <>
            <Button variant="secondary" onClick={close}>
              Cancel
            </Button>
            <Button disabled={checked === undefined || checked.valid_rows === 0 || commit.isPending} onClick={apply}>
              {commit.isPending ? "Importing…" : checked === undefined ? "Import" : `Import ${formatNumber(checked.valid_rows)} ${checked.valid_rows === 1 ? "row" : "rows"}`}
            </Button>
          </>
        ) : (
          <Button onClick={close}>Done</Button>
        )
      }
    >
      <div className="flex flex-col gap-4">
        {result === undefined ? (
          <>
            <Field label="File" hint="CSV or Excel, up to 5 MB and 1,000 rows. One row per item: name, unit, quantity, optional cost and expiry.">
              <input
                ref={input}
                aria-label="Stock file"
                type="file"
                accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className="text-sm"
                onChange={(event) => {
                  check(event.currentTarget.files?.[0]);
                }}
              />
            </Field>
            {preview.isPending ? (
              <p role="status" className="text-sm text-muted">
                Checking the file…
              </p>
            ) : checked === undefined ? (
              <p className="text-sm text-muted">Choose a file to see what would be imported.</p>
            ) : (
              <PreviewBody checked={checked} />
            )}
          </>
        ) : (
          <div role="status" className="flex flex-col gap-1">
            <p className="font-bold">{result.replayed ? "This list was already imported." : "Stock imported."}</p>
            <p className="text-sm text-muted">
              {formatNumber(result.items_created)} new {result.items_created === 1 ? "item" : "items"}, {formatNumber(result.items_updated)} updated,{" "}
              {formatNumber(result.units_received)} units received in {formatNumber(result.batches_received)} {result.batches_received === 1 ? "batch" : "batches"}.
              {result.skipped.length > 0 ? ` ${formatNumber(result.skipped.length)} skipped.` : ""}
            </p>
          </div>
        )}
        {error === undefined ? null : (
          <p role="alert" className="text-sm font-medium text-danger-text">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}

function PreviewBody({ checked }: { checked: StockImportPreview }) {
  return (
    <section aria-label="Import preview" className="flex flex-col gap-3">
      <p className="text-sm">
        <b>{checked.file_name}</b>: {formatNumber(checked.row_count)} rows, {formatNumber(checked.valid_rows)} ready ({formatNumber(checked.new_items)} new), {formatNumber(checked.error_rows)} with
        problems.
      </p>
      {checked.warnings.map((w) => (
        <p key={w} className="text-sm text-warning-text">
          {w}
        </p>
      ))}
      {checked.errors.length > 0 ? (
        <div>
          <h3 className="mb-1 text-sm font-bold text-text">Rows to fix (skipped unless you fix the file)</h3>
          <ul aria-label="Row errors" className="divide-y divide-border text-sm">
            {checked.errors.map((e, n) => (
              <li key={`${String(e.row)}-${e.field}-${String(n)}`} className="py-1.5 text-danger-text">
                Row {e.row}, {e.field}: {e.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {checked.rows.length === 0 ? (
        <p className="text-sm text-muted">No row can be imported yet. Fix the file and choose it again.</p>
      ) : (
        <div className="st2-tablewrap">
          <table className="st2-table" aria-label="Rows to import">
            <thead>
              <tr>
                <th>Row</th>
                <th>Item</th>
                <th className="num">Quantity</th>
                <th>New?</th>
              </tr>
            </thead>
            <tbody>
              {checked.rows.map((r) => (
                <tr key={r.row}>
                  <td>{r.row}</td>
                  <td>{r.name}</td>
                  <td className="num">{formatNumber(r.quantity)}</td>
                  <td>{r.new_item ? "New item" : "Existing"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
