import type { ChartEntry, PatientId, ToothSurface } from "@aarogyam/api-client";
import { ApiErrorNotice, formatDate } from "@aarogyam/app-kit";
import { MkCard } from "../../components/mk/index.js";
import { useState } from "react";

import { useClinic } from "../../clinic.js";
import { useDentalChart, useVisits } from "../../queries.js";
import { FINDING_STYLE, surfaceLabel } from "../visits/odontogram/model.js";
import { Odontogram } from "../visits/odontogram/odontogram.js";
import { RecordFindingDialog } from "../visits/record-finding-dialog.js";
import { usePlans } from "../treatment-plans/queries.js";
import { SkeletonRows } from "../../components/skeleton-rows.js";

/** The odontogram: every tooth's current findings by surface, planned and done treatment, and (with clinical.write) the record dialog. */
export function DentalChartPanel({ patientId }: { patientId: PatientId }) {
  const chart = useDentalChart(patientId);
  const plans = usePlans(patientId);
  const { can } = useClinic();
  const visits = useVisits(patientId);
  const [recording, setRecording] = useState<{ teeth: readonly number[]; surface: ToothSurface | null } | undefined>(undefined);
  if (chart.isPending) {
    return <SkeletonRows count={2} tall label="Loading the dental chart" />;
  }
  if (chart.isError) {
    return <ApiErrorNotice title="Couldn't load the dental chart" error={chart.error} onRetry={() => void chart.refetch()} />;
  }
  const openVisit = visits.data?.items.find((v) => v.status === "open");
  const planItems = plans.data?.items.flatMap((plan) => plan.items) ?? [];

  return (
    <MkCard title="Dental chart">
      <Odontogram
        patientId={patientId}
        chart={chart.data}
        planItems={planItems}
        onRecord={
          can("clinical.write")
            ? (teeth, surface) => {
                setRecording({ teeth, surface });
              }
            : undefined
        }
      />
      {recording === undefined ? null : (
        <RecordFindingDialog
          patientId={patientId}
          teeth={recording.teeth}
          terms={chart.data.terms}
          initialSurface={recording.surface ?? undefined}
          visitId={openVisit?.id}
          onOpenChange={() => {
            setRecording(undefined);
          }}
        />
      )}
      <ToothDetails entries={chart.data.current} />
    </MkCard>
  );
}

/** Tooth by tooth: what each tooth and surface has now, with the procedure and material. The tooth panel holds the full history. */
function ToothDetails({ entries }: { entries: readonly ChartEntry[] }) {
  const detailed = entries.filter((e) => e.procedure != null || e.material != null);
  if (detailed.length === 0) return null;
  return (
    <div className="odo odo-details-wrap" style={{ marginTop: 16, gap: 0 }}>
      <p className="odo-legend-title">Treatment details</p>
      <table className="odo-details" aria-label="Treatment details by tooth">
        <thead>
          <tr>
            <th scope="col">Tooth</th>
            <th scope="col">Surface</th>
            <th scope="col">Finding</th>
            <th scope="col">Procedure</th>
            <th scope="col">Material</th>
            <th scope="col">Date</th>
          </tr>
        </thead>
        <tbody>
          {detailed.map((entry) => (
            <tr key={entry.id}>
              <td>{entry.tooth}</td>
              <td>{entry.surface == null ? "Whole tooth" : surfaceLabel(entry.tooth, entry.surface)}</td>
              <td>{FINDING_STYLE[entry.finding].label}</td>
              <td>{entry.procedure?.label ?? "—"}</td>
              <td>{entry.material?.label ?? "—"}</td>
              <td>
                <time dateTime={entry.effective_at}>{formatDate(entry.effective_at)}</time>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
