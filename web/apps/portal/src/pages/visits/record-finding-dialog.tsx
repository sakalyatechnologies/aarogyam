import { useState } from "react";

import { apiErrorOf, type ChartFinding, type PatientId, type ToothSurface, type VisitId } from "@aarogyam/api-client";
import { Button, Dialog, Field, Select, TextInput, useToast } from "@sakalya/ui";

import { useRecordChartEntries } from "../../queries.js";

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

const SURFACES: readonly { value: ToothSurface | "whole"; label: string }[] = [
  { value: "whole", label: "Whole tooth" },
  { value: "M", label: "Mesial" },
  { value: "O", label: "Occlusal" },
  { value: "D", label: "Distal" },
  { value: "B", label: "Buccal" },
  { value: "L", label: "Lingual" },
];

/** Records one finding on a tooth, in the open visit when there is one; the chart refreshes on save. */
export function RecordFindingDialog({
  patientId,
  tooth,
  visitId,
  onOpenChange,
}: {
  patientId: PatientId;
  tooth: number;
  visitId?: VisitId | undefined;
  onOpenChange: () => void;
}) {
  const [finding, setFinding] = useState<ChartFinding>("caries");
  const [surface, setSurface] = useState<ToothSurface | "whole">("whole");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);
  const record = useRecordChartEntries(patientId);
  const toast = useToast();

  const submit = () => {
    setError(undefined);
    record.mutate(
      {
        entries: [
          {
            tooth,
            finding,
            ...(surface === "whole" ? {} : { surface }),
            ...(note.trim() === "" ? {} : { note: note.trim() }),
          },
        ],
        ...(visitId === undefined ? {} : { visit_id: visitId }),
      },
      {
        onSuccess: () => {
          toast.show({ title: `Tooth ${String(tooth)} recorded`, tone: "success" });
          onOpenChange();
        },
        onError: (thrown) => {
          setError(apiErrorOf(thrown)?.message ?? "Couldn't record that finding. Please try again.");
        },
      },
    );
  };

  return (
    <Dialog
      open
      onOpenChange={onOpenChange}
      title={`Record a finding: tooth ${String(tooth)}`}
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
        <Field label="Surface">
          <Select options={SURFACES} value={surface} onValueChange={setSurface} />
        </Field>
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
