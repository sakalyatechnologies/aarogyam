import { useState } from "react";


import type { Patient, ToothSurface } from "@aarogyam/api-client";
import { ApiErrorNotice } from "@aarogyam/app-kit";

import { SkeletonRows } from "../../../../components/skeleton-rows.js";
import { useClinic } from "../../../../clinic.js";
import { useDentalChart, useProcedures, useStaff } from "../../../../queries.js";
import { usePlans } from "../../../treatment-plans/queries.js";
import { Odontogram } from "../../../visits/odontogram/odontogram.js";
import { Bento, Pills } from "../kit.js";
import { useVisitSession } from "../visit-session.js";
import { LOOKS, ToothChart } from "./tooth-chart.js";
import { ToothPanel } from "./tooth-panel.js";
import { useChartPrefs } from "./use-chart-prefs.js";

/** The New look tooth chart: rows or 3D arch, with the tooth's history and the Add treatment form beside it. */
export function ToothChartBlock({ patientId }: { patientId: Patient["id"] }) {
  const { can, session } = useClinic();
  const visit = useVisitSession();
  const chart = useDentalChart(patientId);
  const plans = usePlans(patientId);
  const procedures = useProcedures(can("clinical.read") ? patientId : undefined);
  // Doctors' names come from the team list, which only people who manage staff may read; others see no name on a row.
  const staff = useStaff(can("staff.manage"));
  const [selected, setSelected] = useState<number | undefined>(undefined);
  const [surface, setSurface] = useState<ToothSurface | null>(null);
  const [prefs, setPrefs] = useChartPrefs(session.user.id);

  if (chart.isPending) {
    return (
      <Bento level={2} title="Dental chart">
        <SkeletonRows count={2} tall label="Loading the dental chart" />
      </Bento>
    );
  }
  if (chart.isError) {
    return (
      <Bento level={2} title="Dental chart">
        <ApiErrorNotice title="Couldn't load the dental chart" error={chart.error} onRetry={() => void chart.refetch()} />
      </Bento>
    );
  }
  const planItems = plans.data?.items.flatMap((plan) => plan.items) ?? [];
  const members = staff.data?.members ?? [];
  const planned = planItems.filter((item) => item.tooth != null && (item.status === "proposed" || item.status === "accepted")).length;
  const done = new Set(chart.data.current.filter((e) => e.finding !== "sound").map((e) => e.tooth)).size;
  const panel = (
    <ToothPanel
      patientId={patientId}
      tooth={selected}
      surface={surface}
      visitId={visit.visit?.id}
      canWrite={visit.canWrite}
      starting={visit.starting}
      onStartVisit={visit.startVisit}
      terms={chart.data.terms}
      planItems={planItems}
      procedures={procedures.data?.items ?? []}
      who={(id) => (id == null ? undefined : members.find((m) => m.id === id)?.display_name)}
      onClose={() => {
        setSelected(undefined);
      }}
    />
  );
  return (
    <Bento
      level={2}
      title="Dental chart"
      sub={`${String(planned)} planned, ${String(done)} with treatment`}
      action={<Pills label="Chart look" size="sm" options={LOOKS} value={prefs.look} onChange={(look) => { setPrefs({ look }); }} />}
    >
      <div className="tc-wrap">
        {prefs.look === "classic" ? (
          // The existing odontogram with its five surfaces; a tooth opens the same panel as the other views.
          <Odontogram
            patientId={patientId}
            chart={chart.data}
            planItems={planItems}
            onRecord={undefined}
            panel={panel}
            shownTooth={selected}
            onPick={(tooth, picked) => {
              setSelected(tooth);
              setSurface(picked);
            }}
          />
        ) : (
          <div className="tc-split">
            <ToothChart
              look={prefs.look}
              dentition={prefs.dentition}
              onDentition={(dentition) => {
                setPrefs({ dentition });
              }}
              current={chart.data.current}
              planItems={planItems}
              selected={selected}
              onSelect={(tooth) => {
                setSelected(tooth);
                setSurface(null);
              }}
            />
            {panel}
          </div>
        )}
      </div>
    </Bento>
  );
}
