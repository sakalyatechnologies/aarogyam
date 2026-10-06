import { useState } from "react";

import { apiErrorOf, type ChartFinding, type DentalTerm, type PatientId, type ToothSurface, type VisitId } from "@aarogyam/api-client";
import { Button, Dialog, Field, Select, TextInput, useToast } from "@sakalya/ui";

import { useAddDentalTerm, useRecordChartEntries } from "../../queries.js";
import { SURFACES, isWholeToothFinding, surfaceLabel } from "./odontogram/model.js";
import { TermCombobox } from "./term-combobox.js";

const FINDINGS: readonly { value: ChartFinding; label: string }[] = [
  { value: "sound", label: "Sound (clears an earlier finding)" },
  { value: "caries", label: "Caries" },
  { value: "filled", label: "Filled" },
  { value: "crown", label: "Crown" },
  { value: "missing", label: "Missing" },
  { value: "implant", label: "Implant" },
  { value: "root_canal", label: "Root canal" },
  { value: "bridge", label: "Bridge" },
  { value: "fractured", label: "Fractured" },
  { value: "watch", label: "Watch" },
];

/** Surface names for several teeth at once, front and back. */
const GENERIC_SURFACE: Readonly<Record<ToothSurface, string>> = {
  M: "Mesial",
  D: "Distal",
  O: "Occlusal / incisal",
  B: "Buccal / labial",
  L: "Lingual / palatal",
};

/**
 * Records a finding on one or several teeth, on the whole tooth or on chosen surfaces, with the procedure and material picked
 * from the clinic's list (type-ahead, "Add new"). Saved in the open visit when there is one; the chart refreshes on save.
 */
export function RecordFindingDialog({
  patientId,
  teeth,
  terms,
  visitId,
  initialSurface,
  onOpenChange,
}: {
  patientId: PatientId;
  teeth: readonly number[];
  /** The chart's procedures and materials, loaded with it. */
  terms: readonly DentalTerm[];
  visitId?: VisitId | undefined;
  /** Pre-selects a surface, for a click on one in the odontogram. */
  initialSurface?: ToothSurface | undefined;
  onOpenChange: () => void;
}) {
  const [finding, setFinding] = useState<ChartFinding>("caries");
  const [surfaces, setSurfaces] = useState<readonly ToothSurface[]>(initialSurface === undefined ? [] : [initialSurface]);
  const [procedure, setProcedure] = useState<DentalTerm | undefined>(undefined);
  const [material, setMaterial] = useState<DentalTerm | undefined>(undefined);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);
  const record = useRecordChartEntries(patientId);
  const addTerm = useAddDentalTerm();
  const toast = useToast();

  // Crown, root canal, missing, implant and bridge cover the whole tooth; the API refuses a surface for them.
  const wholeOnly = isWholeToothFinding(finding);
  const chosen = wholeOnly ? [] : surfaces;
  const sound = finding === "sound";
  const one = teeth.length === 1 ? teeth[0] : undefined;
  const label = (surface: ToothSurface) => (one === undefined ? GENERIC_SURFACE[surface] : surfaceLabel(one, surface));
  const title = one === undefined ? `teeth ${teeth.join(", ")}` : `tooth ${String(one)}`;

  const submit = () => {
    setError(undefined);
    const detail = {
      finding,
      ...(sound || procedure === undefined ? {} : { procedure: procedure.id }),
      ...(sound || material === undefined ? {} : { material: material.id }),
      ...(note.trim() === "" ? {} : { note: note.trim() }),
    };
    const entries = teeth.flatMap((tooth) => (chosen.length === 0 ? [{ tooth, ...detail }] : chosen.map((surface) => ({ tooth, surface, ...detail }))));
    record.mutate(
      { entries, ...(visitId === undefined ? {} : { visit_id: visitId }) },
      {
        onSuccess: () => {
          toast.show({ title: `${title.charAt(0).toUpperCase()}${title.slice(1)} recorded`, tone: "success" });
          onOpenChange();
        },
        onError: (thrown) => {
          setError(apiErrorOf(thrown)?.message ?? "Couldn't record that finding. Please try again.");
        },
      },
    );
  };

  const add = (kind: DentalTerm["kind"]) => (text: string) => addTerm.mutateAsync({ kind, label: text });

  return (
    <Dialog
      open
      onOpenChange={onOpenChange}
      title={`Record a finding: ${title}`}
      footer={
        <>
          <Button variant="secondary" onClick={onOpenChange}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={record.isPending}>
            {record.isPending ? "Saving…" : "Save"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Finding">
          <Select options={FINDINGS} value={finding} onValueChange={setFinding} />
        </Field>
        <div role="group" aria-label="Surfaces">
          <p className="mb-1.5 text-sm font-semibold">Surfaces</p>
          <div className="odo-surface-toggles">
            <button
              type="button"
              aria-pressed={chosen.length === 0}
              onClick={() => {
                setSurfaces([]);
              }}
            >
              Whole tooth
            </button>
            {SURFACES.map((surface) => (
              <button
                key={surface}
                type="button"
                disabled={wholeOnly}
                aria-pressed={chosen.includes(surface)}
                onClick={() => {
                  setSurfaces(surfaces.includes(surface) ? surfaces.filter((s) => s !== surface) : [...surfaces, surface]);
                }}
              >
                {label(surface)}
              </button>
            ))}
          </div>
          {wholeOnly ? <p className="mt-1 text-xs text-muted">This finding covers the whole tooth.</p> : null}
        </div>
        {sound ? null : (
          <>
            <Field label="Procedure">
              <TermCombobox kind="procedure" terms={terms} value={procedure} onChange={setProcedure} onAdd={add("procedure")} />
            </Field>
            <Field label="Material">
              <TermCombobox kind="material" terms={terms} value={material} onChange={setMaterial} onAdd={add("material")} />
            </Field>
          </>
        )}
        <Field label="Remark">
          <TextInput
            value={note}
            onChange={(event) => {
              setNote(event.target.value);
            }}
          />
        </Field>
        {error === undefined ? null : (
          <p role="alert" className="text-sm font-medium text-danger-text">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}
