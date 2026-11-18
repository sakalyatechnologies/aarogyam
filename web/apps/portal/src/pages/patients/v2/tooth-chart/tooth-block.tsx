import { useCallback, useState } from "react";


import type { Patient, ToothSurface } from "@aarogyam/api-client";
import { ApiErrorNotice, formatDate } from "@aarogyam/app-kit";

import { SkeletonRows } from "../../../../components/skeleton-rows.js";
import { useClinic } from "../../../../clinic.js";
import { useDentalChart, useProcedures, useStaff, useVisits } from "../../../../queries.js";
import { usePlans } from "../../../treatment-plans/queries.js";
import { Odontogram } from "../../../visits/odontogram/odontogram.js";
import { Bento, Pills, PopoverPill } from "../kit.js";
import { useVisitSession } from "../visit-session.js";
import { useToothHealthSaver } from "./health-row.js";
import { countLabel, progress } from "./model.js";
import { ChartKey, DENTITIONS, LOOKS, ToothChart, VIEWS } from "./tooth-chart.js";
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
  const visits = useVisits(can("clinical.read") ? patientId : undefined);
  const saver = useToothHealthSaver(patientId);
  // The tooth a long press picked: its panel starts dictating the note once.
  const [dictate, setDictate] = useState<number | undefined>(undefined);
  const dictated = useCallback(() => {
    setDictate(undefined);
  }, []);

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
  const statuses = chart.data.statuses ?? [];
  const canWrite = can("clinical.write");
  // Nothing is open until a tooth is picked, so the chart keeps the full width.
  const panel =
    selected === undefined ? null : (
    <ToothPanel
      patientId={patientId}
      tooth={selected}
      surface={surface}
      visitId={visit.visit?.id}
      canWrite={visit.canWrite}
      terms={chart.data.terms}
      planItems={planItems}
      procedures={procedures.data?.items ?? []}
      who={(id) => (id == null ? undefined : members.find((m) => m.id === id)?.display_name)}
      onClose={() => {
        setSelected(undefined);
      }}
      entries={chart.data.current.filter((e) => e.tooth === selected)}
      status={statuses.find((s) => s.tooth === selected)}
      dictate={dictate === selected}
      onDictateStarted={dictated}
    />
  );
  return (
    <Bento
      level={2}
      title="Dental chart"
      sub={`${String(planned)} planned · ${String(done)} treated`}
      action={
        <div className="p360-tools">
          <Pills label="Chart look" size="sm" options={LOOKS} value={prefs.look} onChange={(look) => { setPrefs({ look }); }} />
          {prefs.look === "classic" ? null : (
            <Pills label="Dentition" size="sm" options={DENTITIONS} value={prefs.dentition} onChange={(dentition) => { setPrefs({ dentition }); }} />
          )}
          {prefs.look === "classic" ? null : (
            <Pills label="Chart view" size="sm" options={VIEWS} value={prefs.view} onChange={(view) => { setPrefs({ view }); }} />
          )}
          <PopoverPill label="Key" title="Chart key">
            <ChartKey view={prefs.look === "classic" ? "treatment" : prefs.view} />
          </PopoverPill>
        </div>
      }
    >
      <div className="tc-wrap">
        <ProgressLine history={chart.data.current} procedures={procedures.data?.items ?? []} since={visits.data?.items.map((v) => v.started_at).sort()[0]} />
        {prefs.look === "classic" ? (
          // The existing odontogram with its five surfaces; a tooth opens the same panel as the other views.
          <Odontogram
            patientId={patientId}
            chart={chart.data}
            planItems={planItems}
            onRecord={undefined}
            panel={panel ?? <></>}
            compact
            shownTooth={selected}
            onPick={(tooth, picked) => {
              setSelected(tooth);
              setSurface(picked);
            }}
          />
        ) : (
          <div className="tc-split" data-open={selected === undefined ? undefined : ""}>
            <ToothChart
              look={prefs.look}
              dentition={prefs.dentition}
              view={prefs.view}
              current={chart.data.current}
              statuses={statuses}
              planItems={planItems}
              selected={selected}
              onSelect={(tooth) => {
                setSelected(tooth);
                setSurface(null);
              }}
              onLongPress={(tooth) => {
                setSelected(tooth);
                setSurface(null);
                setDictate(tooth);
              }}
              onHealthKey={
                canWrite
                  ? (tooth, health) => {
                      const before = statuses.find((s) => s.tooth === tooth);
                      setSelected(tooth);
                      setSurface(null);
                      saver.save(tooth, { health, note: before?.note ?? "", months: before?.treat_within_months ?? undefined });
                    }
                  : undefined
              }
            />
            {panel}
          </div>
        )}
      </div>
    </Bento>
  );
}

/** "Since you joined (12 Mar 2026): 6 teeth treated here — 3 fillings, 1 root canal. Before: 4 teeth with work from elsewhere." Hidden when there is nothing to say. */
function ProgressLine({ history, procedures, since }: { history: Parameters<typeof progress>[0]; procedures: Parameters<typeof progress>[1]; since: string | undefined }) {
  const counted = progress(history, procedures);
  if (counted.here === 0 && counted.before === 0 && counted.byTreatment.length === 0) return null;
  const teeth = (n: number) => `${String(n)} ${n === 1 ? "tooth" : "teeth"}`;
  const work = counted.byTreatment.map(countLabel).join(", ");
  return (
    <p className="tc-progress" aria-label="Progress">
      {counted.here > 0 || work !== "" ? (
        <>
          <strong>{since === undefined ? "At this clinic" : `Since you joined (${formatDate(since)})`}</strong>
          {`: ${teeth(counted.here)} treated here${work === "" ? "" : ` — ${work}`}.`}
        </>
      ) : null}
      {counted.before > 0 ? (
        <>
          {" "}
          <strong>Before:</strong>
          {` ${teeth(counted.before)} with work from elsewhere.`}
        </>
      ) : null}
    </p>
  );
}
