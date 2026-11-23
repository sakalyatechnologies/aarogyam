import { useState } from "react";

import { apiErrorOf, type ChartFinding, type DentalTerm, type NewChartEntry, type PatientId, type ToothSurface, type VisitId } from "@aarogyam/api-client";
import { Button, Dialog, Field, Select, TextInput, useToast } from "@sakalya/ui";

import { DETAIL_CHIPS, DETAIL_VALUES } from "@aarogyam/app-kit/mouth-art";

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

/** What one finding becomes: an entry per tooth, or per tooth and surface; the depth only on caries, nothing extra on sound. */
export function findingEntries(
  teeth: readonly number[],
  f: { finding: ChartFinding; surfaces: readonly ToothSurface[]; depth?: string | undefined; note?: string | undefined; procedure?: DentalTerm | undefined; material?: DentalTerm | undefined },
): NewChartEntry[] {
  const sound = f.finding === "sound";
  const note = f.note?.trim() ?? "";
  const detail = {
    finding: f.finding,
    ...(sound || f.procedure === undefined ? {} : { procedure: f.procedure.id }),
    ...(sound || f.material === undefined ? {} : { material: f.material.id }),
    ...(note === "" ? {} : { note }),
    ...(f.finding === "caries" && f.depth !== undefined ? { caries_depth: f.depth } : {}),
  };
  // Crown, root canal, missing, implant and bridge cover the whole tooth; the API refuses a surface for them.
  const surfaces = isWholeToothFinding(f.finding) ? [] : f.surfaces;
  return teeth.flatMap((tooth) => (surfaces.length === 0 ? [{ tooth, ...detail }] : surfaces.map((surface) => ({ tooth, surface, ...detail }))));
}

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
  // Nothing is preselected: a click on a sound tooth must not become "Caries" by accident.
  const [finding, setFinding] = useState<ChartFinding | "">("");
  const [missingFinding, setMissingFinding] = useState(false);
  const [surfaces, setSurfaces] = useState<readonly ToothSurface[]>(initialSurface === undefined ? [] : [initialSurface]);
  const [procedure, setProcedure] = useState<DentalTerm | undefined>(undefined);
  const [material, setMaterial] = useState<DentalTerm | undefined>(undefined);
  const [note, setNote] = useState("");
  const [depth, setDepth] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const record = useRecordChartEntries(patientId);
  const addTerm = useAddDentalTerm();
  const toast = useToast();

  // Crown, root canal, missing, implant and bridge cover the whole tooth; the API refuses a surface for them.
  const wholeOnly = finding !== "" && isWholeToothFinding(finding);
  const chosen = wholeOnly ? [] : surfaces;
  const sound = finding === "sound";
  const one = teeth.length === 1 ? teeth[0] : undefined;
  const label = (surface: ToothSurface) => (one === undefined ? GENERIC_SURFACE[surface] : surfaceLabel(one, surface));
  const title = one === undefined ? `teeth ${teeth.join(", ")}` : `tooth ${String(one)}`;

  const submit = () => {
    setError(undefined);
    if (finding === "") {
      setMissingFinding(true);
      return;
    }
    const entries = findingEntries(teeth, { finding, surfaces: chosen, depth, note, procedure, material });
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
        // The dialog's own Close button dismisses it, so there is no second Cancel here.
        <Button onClick={submit} disabled={record.isPending}>
          {record.isPending ? "Saving…" : "Save"}
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Finding" required error={missingFinding && finding === "" ? "Choose a finding." : undefined}>
          <Select options={FINDINGS} value={finding} placeholder="Choose a finding" onValueChange={setFinding} />
        </Field>
        {finding === "caries" ? (
          <div role="group" aria-label="Depth (optional)">
            <p className="mb-1.5 text-sm font-semibold">Depth <span className="font-normal text-muted">(optional)</span></p>
            <div className="odo-surface-toggles">
              {DETAIL_VALUES.caries_depth.map((d) => (
                <button key={d} type="button" aria-pressed={depth === d} onClick={() => { setDepth(depth === d ? undefined : d); }}>
                  {DETAIL_CHIPS.caries_depth[d]}
                </button>
              ))}
            </div>
          </div>
        ) : null}
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
