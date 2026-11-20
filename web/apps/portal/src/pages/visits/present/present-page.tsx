/**
 * Present mode (design §1.12): the doctor turns the screen to the patient and walks the same mouth
 * view the patient's page shows, from `GET /visits/{id}/mouth`. Full screen, large targets. Esc goes
 * back to the overview; only the press-and-hold Exit leaves, so a patient tapping around can't land
 * in Patient 360. The query refetches after chart, plan, procedure, tooth-status and booking saves.
 */
import { Brush, Moon, Sun } from "lucide-react";
import { Suspense, lazy, useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";

import { apiErrorOf, visitId as parseVisitId, type ChartEntry, type MouthSnapshot, type NewChartEntry, type PatientId, type VisitId } from "@aarogyam/api-client";
import { ApiErrorNotice } from "@aarogyam/app-kit";
import { DETAIL_CHIPS, DETAIL_VALUES } from "@aarogyam/app-kit/mouth-art";
import { MouthView, brushingBand, preloadArt } from "@aarogyam/app-kit/mouth-view";
import "@aarogyam/app-kit/mouth-view.css";
import { useToast } from "@sakalya/ui";

import { useClinic } from "../../../clinic.js";
import { useDentalChart, usePatient, useRecordChartEntries, useVisit, useVisitMouth } from "../../../queries.js";
import { HoldToExit } from "../../patients/v2/explain/hold-to-exit.js";
import "../../patients/v2/explain/explain.css";
import "./present.css";

const load3d = () => import("@aarogyam/app-kit/real-teeth-3d");
// loaded only when asked: the X-rays tab (Explain mode's viewer and pins) and "How to brush"
const XraysTab = lazy(() => import("./xrays-tab.js").then((m) => ({ default: m.XraysTab })));
const BrushingPanel = lazy(() => import("./brushing-panel.js").then((m) => ({ default: m.BrushingPanel })));
type Tab = "teeth" | "xrays";
const TABS: readonly Tab[] = ["teeth", "xrays"];

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
  const [theme, setTheme] = useSchemeTheme();
  const [search] = useSearchParams();
  const [tab, setTab] = useState<Tab>(search.get("tab") === "xrays" ? "xrays" : "teeth");
  const [onlyToday, setOnlyToday] = useState(false);
  // all art chunks start together the moment the snapshot is here (a no-op when Show patient prefetched them)
  if (mouth.data !== undefined) preloadArt(mouth.data);
  return (
    <div className="pm-shell mv-theme" data-mv-theme={theme} role="dialog" aria-modal="true" aria-label="Present mode">
      <header className="pm-bar">
        <div className="pm-who">
          {first === undefined ? "Present mode" : `${first}${age === undefined ? "" : `, ${String(age)}`}`}
          <small>Show patient · the same mouth view as the patient's page</small>
        </div>
        <div className="pm-tabs" role="tablist" aria-label="Show">
          {TABS.map((t) => (
            <button key={t} type="button" role="tab" className="pm-tab" aria-selected={tab === t} onClick={() => { setTab(t); }}>
              {t === "teeth" ? "Teeth" : "X-rays"}
            </button>
          ))}
        </div>
        {tab === "teeth" ? (
          <button type="button" className="pm-chip pm-today" aria-pressed={onlyToday} onClick={() => { setOnlyToday(!onlyToday); }}>
            Today
          </button>
        ) : null}
        <button type="button" className="pm-chip pm-icon" aria-label={theme === "dark" ? "Use light screen" : "Use dark screen"} onClick={() => { setTheme(theme === "dark" ? "light" : "dark"); }}>
          {theme === "dark" ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
        </button>
        {tab === "teeth" ? (
          <button type="button" className="pm-chip pm-brushchip" onClick={() => { setBrushing(true); }}>
            <Brush aria-hidden="true" />
            How to brush
          </button>
        ) : null}
        <HoldToExit onExit={exit} />
      </header>
      <div className="pm-body" hidden={tab !== "teeth"}>
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
            filter={onlyToday ? "today" : undefined}
            load3d={load3d}
            toothExtras={patientId === undefined ? undefined : (tooth) => <AddDepth snapshot={mouth.data} tooth={tooth} patientId={patientId} visitId={visitId} />}
          />
        )}
      </div>
      {tab === "xrays" && patientId !== undefined && visitId !== undefined ? (
        <div className="pm-body pm-body-xrays">
          <Suspense fallback={<p role="status" className="pm-wait">Loading the X-rays…</p>}>
            <XraysTab patientId={patientId} visitId={visitId} imageId={search.get("image") ?? undefined} />
          </Suspense>
        </div>
      ) : null}
      {brushing ? (
        <Suspense fallback={null}>
          <BrushingPanel band={band} name={first} onClose={() => { setBrushing(false); }} />
        </Suspense>
      ) : null}
    </div>
  );
}

/** Light or dark: follows the system (prefers-color-scheme) until the doctor taps the toggle. */
function useSchemeTheme(): ["light" | "dark", (t: "light" | "dark") => void] {
  const query = () => typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: dark)").matches;
  const [system, setSystem] = useState(query);
  const [chosen, setChosen] = useState<"light" | "dark" | undefined>(undefined);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const on = () => { setSystem(mq.matches); };
    mq.addEventListener("change", on);
    return () => { mq.removeEventListener("change", on); };
  }, []);
  return [chosen ?? (system ? "dark" : "light"), setChosen];
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
