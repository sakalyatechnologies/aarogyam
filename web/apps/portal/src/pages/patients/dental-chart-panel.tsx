import type { ChartFinding, PatientId } from "@aarogyam/api-client";
import { ApiErrorNotice } from "@aarogyam/app-kit";
import { Card, Skeleton } from "@sakalya/ui";

import { useDentalChart } from "../../queries.js";

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

/** A read-only odontogram: each tooth's current, whole-tooth finding. Recorded from the visit screen. */
export function DentalChartPanel({ patientId }: { patientId: PatientId }) {
  const chart = useDentalChart(patientId);
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
  const findingOf = (tooth: number): ChartFinding => byTooth.get(tooth) ?? "sound";

  return (
    <Card title="Dental chart">
      <div className="flex flex-col items-center gap-3">
        <ToothRow teeth={UPPER} findingOf={findingOf} />
        <div aria-hidden="true" className="h-px w-full max-w-md bg-border" />
        <ToothRow teeth={LOWER} findingOf={findingOf} />
      </div>
      <div className="mt-5 flex flex-wrap gap-3">
        {ALL_FINDINGS.map((finding) => (
          <span key={finding} className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${FINDING_CLASS[finding]}`}>
            {FINDING_LABEL[finding]}
          </span>
        ))}
      </div>
    </Card>
  );
}

function ToothRow({ teeth, findingOf }: { teeth: readonly number[]; findingOf: (tooth: number) => ChartFinding }) {
  return (
    <div className="flex flex-wrap justify-center gap-1.5" role="list" aria-label="Teeth">
      {teeth.map((tooth) => {
        const finding = findingOf(tooth);
        return (
          <div
            key={tooth}
            role="listitem"
            title={`Tooth ${String(tooth)}: ${FINDING_LABEL[finding]}`}
            className={`flex size-10 flex-col items-center justify-center rounded-lg border text-[11px] font-bold ${FINDING_CLASS[finding]}`}
          >
            <span>{tooth}</span>
          </div>
        );
      })}
    </div>
  );
}
