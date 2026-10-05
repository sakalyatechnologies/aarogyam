import type { ChartFinding, PatientId } from "@aarogyam/api-client";
import { ApiErrorNotice } from "@aarogyam/app-kit";
import { Skeleton } from "@sakalya/ui";
import { MkCard } from "../../components/mk/index.js";
import { useState } from "react";

import { useClinic } from "../../clinic.js";
import { useDentalChart, useVisits } from "../../queries.js";
import { RecordFindingDialog } from "../visits/record-finding-dialog.js";

const UPPER = [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28];
const LOWER = [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38];

const FINDING_CLASS: Readonly<Record<ChartFinding, string>> = {
  sound: "bg-surface border-border text-muted",
  caries: "bg-danger-soft border-danger text-danger-text",
  filled: "bg-info-soft border-info text-info-text",
  crown: "bg-warning-soft border-warning text-warning-text",
  missing: "bg-surface-muted border-border-strong text-muted line-through",
  implant: "bg-primary-soft border-primary text-primary-text",
  root_canal: "bg-warning-soft border-warning text-warning-text",
  bridge: "bg-primary-soft border-primary text-primary-text",
  fractured: "bg-danger-soft border-danger text-danger-text",
  watch: "bg-warning-soft border-warning text-warning-text",
};

const ALL_FINDINGS: readonly ChartFinding[] = [
  "sound",
  "caries",
  "filled",
  "crown",
  "missing",
  "implant",
  "root_canal",
  "bridge",
  "fractured",
  "watch",
];

const FINDING_LABEL: Readonly<Record<ChartFinding, string>> = {
  sound: "Sound",
  caries: "Caries",
  filled: "Filled",
  crown: "Crown",
  missing: "Missing",
  implant: "Implant",
  root_canal: "Root canal",
  bridge: "Bridge",
  fractured: "Fractured",
  watch: "Watch",
};

/** The odontogram: each tooth's current, whole-tooth finding. With clinical.write, a tooth opens the record dialog. */
export function DentalChartPanel({ patientId }: { patientId: PatientId }) {
  const chart = useDentalChart(patientId);
  const { can } = useClinic();
  const visits = useVisits(patientId);
  const [tooth, setTooth] = useState<number | undefined>(undefined);
  if (chart.isPending) {
    return <Skeleton shape="block" />;
  }
  if (chart.isError) {
    return <ApiErrorNotice title="Couldn't load the dental chart" error={chart.error} onRetry={() => void chart.refetch()} />;
  }
  const byTooth = new Map<number, ChartFinding>();
  for (const entry of chart.data.current) {
    if (entry.surface == null) {
      byTooth.set(entry.tooth, entry.finding);
    }
  }
  const findingOf = (toothNumber: number): ChartFinding => byTooth.get(toothNumber) ?? "sound";
  const onPick = can("clinical.write") ? setTooth : undefined;
  const openVisit = visits.data?.items.find((v) => v.status === "open");

  return (
    <MkCard title="Dental chart">
      <div className="flex flex-col items-center gap-3">
        <ToothRow teeth={UPPER} findingOf={findingOf} onPick={onPick} />
        <div aria-hidden="true" className="h-px w-full max-w-md bg-border" />
        <ToothRow teeth={LOWER} findingOf={findingOf} onPick={onPick} />
      </div>
      <div className="mt-5 flex flex-wrap gap-3">
        {ALL_FINDINGS.map((finding) => (
          <span key={finding} className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${FINDING_CLASS[finding]}`}>
            {FINDING_LABEL[finding]}
          </span>
        ))}
      </div>
      {tooth === undefined ? null : (
        <RecordFindingDialog
          patientId={patientId}
          tooth={tooth}
          visitId={openVisit?.id}
          onOpenChange={() => {
            setTooth(undefined);
          }}
        />
      )}
    </MkCard>
  );
}

function ToothRow({
  teeth,
  findingOf,
  onPick,
}: {
  teeth: readonly number[];
  findingOf: (tooth: number) => ChartFinding;
  onPick: ((tooth: number) => void) | undefined;
}) {
  return (
    <div className="flex flex-wrap justify-center gap-1.5" role="list" aria-label="Teeth">
      {teeth.map((tooth) => {
        const finding = findingOf(tooth);
        const box = `flex size-10 flex-col items-center justify-center rounded-lg border text-[11px] font-bold ${FINDING_CLASS[finding]}`;
        return (
          <div key={tooth} role="listitem" title={`Tooth ${String(tooth)}: ${FINDING_LABEL[finding]}`}>
            {onPick === undefined ? (
              <div className={box}>
                <span>{tooth}</span>
              </div>
            ) : (
              <button
                type="button"
                aria-label={`Record a finding for tooth ${String(tooth)} (now ${FINDING_LABEL[finding]})`}
                className={`${box} cursor-pointer hover:ring-2 hover:ring-primary`}
                onClick={() => {
                  onPick(tooth);
                }}
              >
                <span>{tooth}</span>
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
