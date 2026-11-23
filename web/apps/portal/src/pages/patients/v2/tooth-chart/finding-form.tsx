import { ArrowLeft } from "lucide-react";
import { useRef, useState } from "react";

import { apiErrorOf, randomUuid, type ChartFinding, type PatientId, type ToothSurface, type VisitId } from "@aarogyam/api-client";
import { DETAIL_CHIPS, DETAIL_VALUES } from "@aarogyam/app-kit/mouth-art";
import { Button, useToast } from "@sakalya/ui";

import { useRecordChartEntries } from "../../../../queries.js";
import { SURFACES, isWholeToothFinding, surfaceLabel } from "../../../visits/odontogram/model.js";
import { findingEntries } from "../../../visits/record-finding-dialog.js";
import { Chip } from "../kit.js";

/** What a doctor finds at the chair, in the words they use; each is a seeded finding. */
export const QUICK_FINDINGS: readonly { value: ChartFinding; label: string }[] = [
  { value: "caries", label: "Decay" },
  { value: "fractured", label: "Broken" },
  { value: "watch", label: "Watch" },
  { value: "missing", label: "Missing" },
];

/**
 * Record a finding in the open visit, in a few taps: finding, then for decay the surfaces and an optional depth, then Save.
 * The entries carry the visit, so Show patient marks the tooth "found today".
 */
export function FindingForm({ patientId, tooth, visitId, surface, onDone, onClose }: {
  patientId: PatientId;
  tooth: number;
  visitId: VisitId;
  /** A surface picked in the Classic chart starts chosen. */
  surface?: ToothSurface | null | undefined;
  onDone: () => void;
  onClose: () => void;
}) {
  const [finding, setFinding] = useState<ChartFinding | undefined>(undefined);
  const [surfaces, setSurfaces] = useState<readonly ToothSurface[]>(surface == null ? [] : [surface]);
  const [depth, setDepth] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  // One id per save attempt: a retry after a lost response is the same request.
  const attempt = useRef(randomUuid());
  const record = useRecordChartEntries(patientId);
  const toast = useToast();
  const whole = finding !== undefined && isWholeToothFinding(finding);

  const save = () => {
    if (finding === undefined) {
      setError("Choose a finding.");
      return;
    }
    setError(undefined);
    const entries = findingEntries([tooth], { finding, surfaces: whole ? [] : surfaces, depth });
    record.mutate(
      { entries, visit_id: visitId, client_id: attempt.current },
      {
        onSuccess: () => {
          attempt.current = randomUuid();
          const label = QUICK_FINDINGS.find((f) => f.value === finding)?.label ?? finding;
          toast.show({ title: `Tooth ${String(tooth)}: ${label} recorded`, tone: "success" });
          onDone();
        },
        onError: (thrown) => {
          const failure = apiErrorOf(thrown);
          setError(failure?.status === 409 ? "This visit is closed. Start a visit, then try again." : (failure?.message ?? "Couldn't record that finding. Please try again."));
        },
      },
    );
  };

  return (
    <form
      className="tc-form"
      aria-label={`Record a finding on tooth ${String(tooth)}`}
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      <p className="tc-label" id="tc-find-label">
        Finding
      </p>
      <div className="tc-chips" role="group" aria-labelledby="tc-find-label">
        {QUICK_FINDINGS.map((f) => (
          <Chip
            key={f.value}
            pressed={finding === f.value}
            onClick={() => {
              setFinding(f.value);
              setError(undefined);
            }}
          >
            {f.label}
          </Chip>
        ))}
      </div>

      {finding === undefined || whole ? null : (
        <>
          <p className="tc-label" id="tc-find-surf-label">
            Surfaces
          </p>
          <div className="tc-chips" role="group" aria-labelledby="tc-find-surf-label">
            <Chip
              pressed={surfaces.length === 0}
              onClick={() => {
                setSurfaces([]);
              }}
            >
              Whole tooth
            </Chip>
            {SURFACES.map((s) => (
              <Chip
                key={s}
                pressed={surfaces.includes(s)}
                onClick={() => {
                  setSurfaces(surfaces.includes(s) ? surfaces.filter((x) => x !== s) : [...surfaces, s]);
                }}
              >
                {surfaceLabel(tooth, s)}
              </Chip>
            ))}
          </div>
        </>
      )}

      {finding === "caries" ? (
        <>
          <p className="tc-label" id="tc-find-depth-label">
            Depth <span className="tc-meta">(optional)</span>
          </p>
          <div className="tc-chips" role="group" aria-labelledby="tc-find-depth-label">
            {DETAIL_VALUES.caries_depth.map((d) => (
              <Chip
                key={d}
                pressed={depth === d}
                onClick={() => {
                  setDepth(depth === d ? undefined : d);
                }}
              >
                {DETAIL_CHIPS.caries_depth[d]}
              </Chip>
            ))}
          </div>
        </>
      ) : null}

      {error === undefined ? null : (
        <p role="alert" className="tc-error">
          {error}
        </p>
      )}
      <div className="tc-actions" style={{ marginTop: 12 }}>
        <Button type="submit" disabled={record.isPending}>
          {record.isPending ? "Saving…" : "Save finding"}
        </Button>
        <Button variant="secondary" type="button" icon={<ArrowLeft aria-hidden="true" className="size-4" />} onClick={onDone}>
          Back
        </Button>
        <Button variant="secondary" type="button" onClick={onClose}>
          Close
        </Button>
      </div>
    </form>
  );
}
