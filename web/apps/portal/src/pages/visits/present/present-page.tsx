/**
 * Present mode (design §1.12): the doctor turns the screen to the patient and walks the same mouth
 * view the patient's page shows, from `GET /visits/{id}/mouth`. Full screen, large targets. Esc goes
 * back to the overview; only the press-and-hold Exit leaves, so a patient tapping around can't land
 * in Patient 360. The query refetches after chart, plan, procedure, tooth-status and booking saves.
 */
import { Brush } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";

import { apiErrorOf, visitId as parseVisitId, type ChartEntry, type MouthSnapshot, type NewChartEntry, type PatientId, type VisitId } from "@aarogyam/api-client";
import { ApiErrorNotice } from "@aarogyam/app-kit";
import { BAND_INFO, BrushingAnimation, DETAIL_CHIPS, DETAIL_VALUES, loadBrushingArt, type BrushingArt, type BrushingBand } from "@aarogyam/app-kit/mouth-art";
import { MouthView, brushingBand } from "@aarogyam/app-kit/mouth-view";
import "@aarogyam/app-kit/mouth-view.css";
import { useToast } from "@sakalya/ui";

import { useClinic } from "../../../clinic.js";
import { useDentalChart, usePatient, useRecordChartEntries, useVisit, useVisitMouth } from "../../../queries.js";
import { HoldToExit } from "../../patients/v2/explain/explain-mode.js";
import "../../patients/v2/explain/explain.css";
import "./present.css";

const load3d = () => import("@aarogyam/app-kit/real-teeth-3d");

export function PresentPage() {
  const params = useParams();
  const parsed = parseVisitId.safeParse(params["visitId"]);
  const visitId = parsed.success ? parsed.data : undefined;
  const navigate = useNavigate();
  const exit = () => {
    void navigate(-1);
  };
  const visit = useVisit(visitId);
  const mouth = useVisitMouth(visitId);
  const patientId = visit.data?.visit.patient_id;
  const patient = usePatient(patientId);
  const [brushing, setBrushing] = useState(false);
  const first = patient.data?.full_name.trim().split(/\s+/)[0];
  const age = patient.data?.age_years ?? undefined;
  const band = brushingBand(mouth.data, [], age);
  return (
    <div className="pm-shell mv-theme" role="dialog" aria-modal="true" aria-label="Present mode">
      <header className="pm-bar">
        <div className="pm-who">
          {first === undefined ? "Present mode" : `${first}${age === undefined ? "" : `, ${String(age)}`}`}
          <small>Present mode · the same mouth view as the patient's page</small>
        </div>
        <button type="button" className="pm-chip" onClick={() => { setBrushing(true); }}>
          <Brush aria-hidden="true" />
          How to brush
        </button>
        <HoldToExit onExit={exit} />
      </header>
      <div className="pm-body">
        {visitId === undefined ? (
          <p role="alert">We couldn't find that visit.</p>
        ) : mouth.isPending ? (
          <p role="status" className="pm-wait">Loading the mouth view…</p>
        ) : mouth.isError ? (
          <ApiErrorNotice title="Couldn't load the mouth view" error={mouth.error} onRetry={() => void mouth.refetch()} />
        ) : (
          <MouthView
            snapshot={mouth.data}
            name={first}
            mode="present"
            load3d={load3d}
            toothExtras={patientId === undefined ? undefined : (tooth) => <AddDepth snapshot={mouth.data} tooth={tooth} patientId={patientId} visitId={visitId} />}
          />
        )}
      </div>
      {brushing ? <BrushingPanel band={band} name={first} onClose={() => { setBrushing(false); }} /> : null}
    </div>
  );
}

/** Caries recorded without a depth: one tap records it before the patient sees the "not recorded" illustration (§1.13). */
export function AddDepth({ snapshot, tooth, patientId, visitId }: { snapshot: MouthSnapshot; tooth: number; patientId: PatientId; visitId: VisitId }) {
  const { can } = useClinic();
  const chart = useDentalChart(patientId);
  const record = useRecordChartEntries(patientId);
  const toast = useToast();
  const t = snapshot.teeth.find((x) => x.tooth === tooth);
  if (!can("clinical.write") || t === undefined || !(t.problems ?? []).includes("caries") || t.details?.caries_depth !== undefined) return null;
  const caries: ChartEntry[] = (chart.data?.current ?? []).filter((e) => e.tooth === tooth && e.finding === "caries");
  if (caries.length === 0) return null;
  const save = (depth: string) => {
    const entries: NewChartEntry[] = caries.map((e) => ({
      tooth,
      finding: "caries",
      caries_depth: depth,
      supersedes_id: e.id,
      ...(e.surface == null ? {} : { surface: e.surface }),
      ...(e.procedure?.id === undefined ? {} : { procedure: e.procedure.id }),
      ...(e.material?.id === undefined ? {} : { material: e.material.id }),
    }));
    record.mutate(
      { entries, visit_id: visitId },
      {
        onSuccess: () => { toast.show({ title: `Tooth ${String(tooth)}: depth saved`, tone: "success" }); },
        onError: (thrown) => { toast.show({ title: apiErrorOf(thrown)?.status === 409 ? "The visit is closed; reopen it to add the depth." : "Couldn't save the depth. Please try again.", tone: "danger" }); },
      },
    );
  };
  return (
    <span className="pm-depth" role="group" aria-label="Add depth">
      <span className="pm-depth-label">Add depth</span>
      {DETAIL_VALUES.caries_depth.map((d) => (
        <button key={d} type="button" className="pm-depth-chip" disabled={record.isPending} onClick={() => { save(d); }}>
          {DETAIL_CHIPS.caries_depth[d]}
        </button>
      ))}
    </span>
  );
}

function BrushingPanel({ band, name, onClose }: { band: BrushingBand; name: string | undefined; onClose: () => void }) {
  const [art, setArt] = useState<BrushingArt | undefined>(undefined);
  useEffect(() => {
    let live = true;
    void loadBrushingArt(band).then((a) => { if (live) setArt(a); }, () => undefined);
    return () => { live = false; };
  }, [band]);
  const info = BAND_INFO[band];
  const child = band === "general_under_6" || band === "general_6_12";
  return (
    <div className="pm-brush" role="dialog" aria-modal="true" aria-label={info.title} onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } }}>
      <div className="pm-brush-card">
        <div className="pm-brush-head">
          <h2>{info.title}</h2>
          <button type="button" className="pm-chip" onClick={onClose} autoFocus>Close</button>
        </div>
        {child && name !== undefined ? <p className="pm-muted">{`Help ${name} brush.`}</p> : null}
        {art === undefined ? <div className="pm-brush-wait" aria-hidden="true" /> : <BrushingAnimation art={art} band={band} className="pm-brush-art" />}
        <div className="pm-chips">{info.chips.map((c) => <span key={c} className="mv-chip">{c}</span>)}</div>
      </div>
    </div>
  );
}
