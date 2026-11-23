/**
 * Present mode (design §1.12): the doctor turns the screen to the patient and walks the same mouth
 * view the patient's page shows, from `GET /visits/{id}/mouth`. It opens on a Show patient style
 * (present-studio-design §4; slice 1a: the painted map) drawn from the PresentModel facts; "Chart" in the
 * style switcher draws the doctor's chart look (Rows, 3D arch or Classic) with the chart's numbers and dentition. Full screen, large targets. Esc goes
 * back to the overview; only the press-and-hold Exit leaves, so a patient tapping around can't land
 * in Patient 360. The query refetches after chart, plan, procedure, tooth-status and booking saves.
 */
import { Brush, Moon, Sun } from "lucide-react";
import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";

import { apiErrorOf, visitId as parseVisitId, type ChartEntry, type MouthSnapshot, type NewChartEntry, type PatientId, type VisitId } from "@aarogyam/api-client";
import { ApiErrorNotice } from "@aarogyam/app-kit";
import { DETAIL_CHIPS, DETAIL_VALUES } from "@aarogyam/app-kit/mouth-art";
import { MouthView, brushingBand, preloadArt } from "@aarogyam/app-kit/mouth-view";
import "@aarogyam/app-kit/mouth-view.css";
import {
  DEFAULT_STYLE, HoldToExit, PRESENT_STYLES, PaintedSlot, StorySlot, StyleSwitcher, isShipped, presentFacts,
  type Orientation, type PaintedView, type PresentStyleId, type ShadeKnob, type SwitcherOption,
} from "@aarogyam/app-kit/present";
import "@aarogyam/app-kit/hold-to-exit.css";
import "@aarogyam/app-kit/present.css";
import { useToast } from "@sakalya/ui";

import { useClinic } from "../../../clinic.js";
import { useDentalChart, usePatient, useRecordChartEntries, useSaveUiPrefs, useUiPrefs, useVisit, useVisitMouth } from "../../../queries.js";
import { DENTITIONS, LOOKS } from "../../patients/v2/tooth-chart/tooth-chart.js";
import { useChartPrefs, type ChartDentition, type ChartLook } from "../../patients/v2/tooth-chart/use-chart-prefs.js";
import { usePlans } from "../../treatment-plans/queries.js";
import { useOwnXrays } from "./own-xray-pick.js";
import { PresentChart } from "./present-chart.js";

const load3d = () => import("@aarogyam/app-kit/real-teeth-3d");
// loaded only when asked: the X-rays tab (Explain mode's viewer and pins) and "How to brush"
const XraysTab = lazy(() => import("./xrays-tab.js").then((m) => ({ default: m.XraysTab })));
const OwnXraySlot = lazy(() => import("./own-xray.js").then((m) => ({ default: m.OwnXraySlot })));
const StoryXray = lazy(() => import("./own-xray.js").then((m) => ({ default: m.StoryXray })));
const BrushingPanel = lazy(() => import("@aarogyam/app-kit/present/brushing-panel").then((m) => ({ default: m.BrushingPanel })));
type Tab = "teeth" | "xrays";
const TABS: readonly Tab[] = ["teeth", "xrays"];
/** A Show patient style, or the doctor's chart look. */
type View = PresentStyleId | "chart";
/** Own X-ray is enabled only when the patient has an X-ray or OPG (`xray`: undefined while that is still loading). */
const viewsFor = (xray: boolean | undefined, saved: PresentStyleId): readonly SwitcherOption[] => [
  ...PRESENT_STYLES.map((s) => ({
    id: s.id, label: s.label, beta: s.beta, note: s.id === saved ? "Default" : undefined,
    disabled: !isShipped(s.id) ? "Coming soon" : s.id === "xray" && xray !== true ? (xray === undefined ? "Checking X-rays" : "No X-ray yet") : undefined,
  })),
  { id: "chart", label: "Chart", separate: true },
];
const isStyle = (v: string | undefined): v is PresentStyleId => PRESENT_STYLES.some((s) => s.id === v);
const isView = (v: string): v is View => v === "chart" || isStyle(v);

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
  // Show patient opens on the doctor's saved style ("Make default"); picking another here is for this showing only.
  const uiPrefs = useUiPrefs();
  const saveUiPrefs = useSaveUiPrefs();
  const toast = useToast();
  const savedPref = uiPrefs.data?.present_style;
  const saved: PresentStyleId = isStyle(savedPref) ? savedPref : DEFAULT_STYLE;
  const [picked, setView] = useState<View | undefined>(undefined);
  const [orientation, setOrientation] = useState<Orientation>("mirror");
  const [shade, setShade] = useState<ShadeKnob>("natural");
  // front map or Open wide; undefined until the doctor picks, so the painted style applies its §6.2 rule
  const [paintedView, setPaintedView] = useState<PaintedView | undefined>(undefined);
  const xrays = useOwnXrays(patientId, visitId);
  const hasXray = xrays.loading ? undefined : xrays.images.length > 0;
  // a saved style that can't be drawn for this visit (Own X-ray without an image) falls back to story cards
  const opening: PresentStyleId = isShipped(saved) && (saved !== "xray" || hasXray === true) ? saved : DEFAULT_STYLE;
  const view: View = picked ?? opening;
  const views = useMemo(() => viewsFor(hasXray, saved), [hasXray, saved]);
  const model = useMemo(() => (mouth.data === undefined ? undefined : presentFacts(mouth.data, visitId)), [mouth.data, visitId]);
  // The doctor's chart look and dentition, so the patient sees the same teeth and numbers; switching here is for this showing only.
  const { session } = useClinic();
  const [prefs] = useChartPrefs(session.user.id);
  const [look, setLook] = useState<ChartLook>(prefs.look);
  const [dentition, setDentition] = useState<ChartDentition>(prefs.dentition);
  const chart = useDentalChart(patientId);
  const plans = usePlans(patientId);
  const planItems = plans.data?.items.flatMap((plan) => plan.items) ?? [];
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
        {tab === "teeth" ? <StyleSwitcher options={views} value={view} onChange={(v) => { if (isView(v)) setView(v); }} /> : null}
        {tab === "teeth" && view !== "chart" && view !== saved ? (
          <button
            type="button"
            className="pm-chip"
            disabled={saveUiPrefs.isPending}
            onClick={() => {
              saveUiPrefs.mutate({ present_style: view }, { onError: () => { toast.show({ title: "Couldn't save your default. Please try again.", tone: "danger" }); } });
            }}
          >
            Make default
          </button>
        ) : null}
        {tab === "teeth" && view === "chart" ? (
          <div className="pm-tabs" role="group" aria-label="Chart look">
            {LOOKS.map((l) => (
              <button key={l.value} type="button" className="pm-tab" aria-pressed={look === l.value} onClick={() => { setLook(l.value); }}>
                {l.label}
              </button>
            ))}
          </div>
        ) : null}
        {tab === "teeth" && view === "chart" ? (
          <div className="pm-tabs" role="group" aria-label="Dentition">
            {DENTITIONS.map((d) => (
              <button key={d.value} type="button" className="pm-tab" aria-pressed={dentition === d.value} onClick={() => { setDentition(d.value); }}>
                {d.label}
              </button>
            ))}
          </div>
        ) : null}
        {tab === "teeth" && view === "chart" ? (
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
            overview={view === "chart"
              ? (chart.data === undefined ? undefined : (slot) => <PresentChart look={look} dentition={dentition} chart={chart.data} planItems={planItems} slot={slot} />)
              : model === undefined ? undefined : view === "xray" && patientId !== undefined ? () => (
                <Suspense fallback={<p role="status" className="pm-wait">Loading the X-ray…</p>}>
                  <OwnXraySlot model={model} patientId={patientId} visitId={visitId} load3d={load3d} />
                </Suspense>
              ) : view === "story" ? (slot) => (
                <StorySlot
                  model={model} slot={slot} orientation={orientation} onOrientation={setOrientation} theme={theme} view={paintedView} onView={setPaintedView} load3d={load3d}
                  xray={hasXray === true && patientId !== undefined ? (
                    <Suspense fallback={<p role="status" className="pm-wait">Loading the X-ray…</p>}><StoryXray patientId={patientId} visitId={visitId} /></Suspense>
                  ) : undefined}
                />
              ) : (slot) => (
                <PaintedSlot model={model} slot={slot} orientation={orientation} onOrientation={setOrientation} shade={shade} onShade={setShade} theme={theme} view={paintedView} onView={setPaintedView} load3d={load3d} toothSheet />
              )}
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
