import type { PatientId, ToothSurface } from "@aarogyam/api-client";
import { ApiErrorNotice } from "@aarogyam/app-kit";
import { MkCard } from "../../components/mk/index.js";
import { useState } from "react";

import { useClinic } from "../../clinic.js";
import { useDentalChart, useVisits } from "../../queries.js";
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
  const [recording, setRecording] = useState<{ tooth: number; surface: ToothSurface | null } | undefined>(undefined);
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
            ? (tooth, surface) => {
                setRecording({ tooth, surface });
              }
            : undefined
        }
      />
      {recording === undefined ? null : (
        <RecordFindingDialog
          patientId={patientId}
          tooth={recording.tooth}
          initialSurface={recording.surface ?? undefined}
          visitId={openVisit?.id}
          onOpenChange={() => {
            setRecording(undefined);
          }}
        />
      )}
    </MkCard>
  );
}
