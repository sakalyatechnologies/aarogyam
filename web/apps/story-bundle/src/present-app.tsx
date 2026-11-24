// Present mode on the phone (design §1.12 "Phone parity"): the portal's Show patient shell around the
// same MouthView, fed the `/visits/{id}/mouth` JSON by the app. It opens on the painted map, the web's
// default style (present-studio-design slice 1a), drawn from the same facts. With the options the app
// passes it also has the web's X-rays tab (`xrays`), the doctor's chart look (`chart`), pinned options
// with "What we discussed" and its Save. No API calls: "Add depth", pin edits, discussions
// and Exit go back to the app over the bridge, which owns saving and leaving.
import { Suspense, lazy, useImperativeHandle, useMemo, useRef, useState, type ReactElement, type Ref } from "react";

import type { DentalChart, MouthSnapshot, PresentDiscussion, PresentStudio } from "@aarogyam/api-client";
import type { ChartDentition, ChartLook } from "@aarogyam/app-kit/chart/types";
import { MouthView, brushingBand, preloadArt } from "@aarogyam/app-kit/mouth-view";
import {
  DEFAULT_SHADE, HoldToExit, PRESENT_STYLES, PaintedSlot, PinsProvider, StorySlot, StudioProvider, isShipped, normalizeStyle, presentFacts, usePins,
  type Orientation, type PlanLine, type PresentStyleId, type Shade, type SwitcherOption,
} from "@aarogyam/app-kit/present";
import type { XrayPin } from "@aarogyam/app-kit/present/xray-pins";
import "@aarogyam/app-kit/chart/odontogram.css";
import "@aarogyam/app-kit/chart/tooth-chart.css";
import "@aarogyam/app-kit/chart/present-chart.css";

import type { PageMessage } from "./channel.js";
import type { XrayInput } from "./options.js";
import type { XrayPins } from "./xrays-view.js";

const load3d = () => import("@aarogyam/app-kit/real-teeth-3d");
const MoreMenu = lazy(() => import("@aarogyam/app-kit/present/more-menu").then((m) => ({ default: m.MoreMenu })));
const BrushingPanel = lazy(() => import("@aarogyam/app-kit/present/brushing-panel").then((m) => ({ default: m.BrushingPanel })));
const PinnedDeck = lazy(() => import("@aarogyam/app-kit/present/deck").then((m) => ({ default: m.PinnedDeck })));
const PresentChart = lazy(() => import("@aarogyam/app-kit/chart/present-chart").then((m) => ({ default: m.PresentChart })));
const XraysTab = lazy(() => import("./xrays-view.js").then((m) => ({ default: m.XraysTab })));
const StoryXrayPicture = lazy(() => import("./xrays-view.js").then((m) => ({ default: m.StoryXrayPicture })));

/** What native's `back()` asks of the screen; the page answers whether it went back. */
export interface PresentControls {
  back(): boolean;
}

export const isStyle = (v: unknown): v is PresentStyleId => normalizeStyle(v) === v;

/** A Show patient style, or the doctor's chart look (only when the app passed the chart). */
type View = PresentStyleId | "chart";
const LOOKS: readonly { value: ChartLook; label: string }[] = [{ value: "rows", label: "Rows" }, { value: "arch", label: "3D arch" }, { value: "classic", label: "Classic" }];
const DENTITIONS: readonly { value: ChartDentition; label: string }[] = [{ value: "adult", label: "Adult" }, { value: "child", label: "Child" }];

/** Story, painted and any beta the app lists (Own X-ray is a Story card now; the chart is its own More group). */
export function styleOptions(betas: readonly string[], saved: PresentStyleId): SwitcherOption[] {
  const ids = new Set<PresentStyleId>(["story", "painted"]);
  for (const b of betas) if (isStyle(b)) ids.add(b);
  return PRESENT_STYLES.filter((x) => ids.has(x.id)).map((x) => ({
    id: x.id, label: x.label, beta: x.beta, note: x.id === saved ? "Default" : undefined, disabled: isShipped(x.id) ? undefined : "Coming soon",
  }));
}

/** Caries recorded without a depth: the app records it (§1.13), so the chip only names the tooth. */
export function needsDepth(snapshot: MouthSnapshot, tooth: number): boolean {
  const t = snapshot.teeth.find((x) => x.tooth === tooth);
  return t !== undefined && (t.problems ?? []).includes("caries") && t.details?.caries_depth === undefined;
}

/** The Pinned chip: the deck, compare and "What we discussed"; Save posts one `save_discussion` per scenario. */
function PinnedGate({ studio, saved, canWrite, send }: { studio: PresentStudio | undefined; saved: readonly PresentDiscussion[]; canWrite: boolean; send: (m: PageMessage) => void }): ReactElement | null {
  const pins = usePins();
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  if (pins === undefined || (pins.pins.length === 0 && !open)) return null;
  const labels = new Map(studio?.situations.flatMap((s) => s.options.map((o) => [o.key, o.label] as const)));
  return (
    <>
      <button type="button" className="pm-chip" onClick={() => { setOpen(true); }}>{`Pinned (${String(pins.pins.length)})`}</button>
      {open ? (
        <Suspense fallback={null}>
          <PinnedDeck
            onClose={() => { setOpen(false); setNotice(undefined); }}
            saved={saved}
            labelOf={(key) => labels.get(key) ?? key}
            onSave={(drafts) => {
              if (!canWrite) {
                setNotice("Your role can't save this.");
                return;
              }
              for (const d of drafts) {
                send({ type: "save_discussion", tooth: d.tooth, situation: d.situation, options: d.options, send_to_patient: d.send === true });
              }
              setNotice("Saved");
            }}
          />
          {notice === undefined ? null : <p role="status" className="pm-wait">{notice}</p>}
        </Suspense>
      ) : null}
    </>
  );
}

export function PresentApp({ snapshot, dark, send, controls, style, studio, plans, betas = [], savedShade, canSaveShade = false, xrays, chart, look: askedLook, dentition: askedDentition, discussions = [], canWrite = true }: {
  /** The patient's plan steps (`present(…, { plans })`); undefined: no plan card beyond the recorded plan facts. */
  plans?: readonly PlanLine[] | undefined;
  snapshot: MouthSnapshot;
  dark: boolean;
  /** The opening style, also the doctor's saved default. */
  style: PresentStyleId;
  /** The parsed `/visits/{id}/present` JSON; undefined opens without options. */
  studio?: PresentStudio | undefined;
  betas?: readonly string[];
  /** The patient's saved tooth colour; undefined opens on the default. */
  savedShade?: number | undefined;
  /** Offer "Save colour"; the app saves it. */
  canSaveShade?: boolean;
  /** The patient's X-rays the app fetched; undefined means no X-rays tab. */
  xrays?: readonly XrayInput[] | undefined;
  /** The dental chart; undefined means no Chart in the switcher. */
  chart?: DentalChart | undefined;
  look?: ChartLook | undefined;
  dentition?: ChartDentition | undefined;
  /** What was already saved as discussed for this visit. */
  discussions?: readonly PresentDiscussion[] | undefined;
  /** false when the member can't save pins or discussions. */
  canWrite?: boolean | undefined;
  send: (m: PageMessage) => void;
  controls: Ref<PresentControls>;
}): ReactElement {
  const [brushing, setBrushing] = useState(false);
  const [onlyToday, setOnlyToday] = useState(false);
  const detail = useRef(false);
  const [orientation, setOrientation] = useState<Orientation>("mirror");
  const [dark2, setDark2] = useState<boolean | undefined>(undefined);
  const isDark = dark2 ?? dark;
  const [saved, setSaved] = useState<Shade>(savedShade ?? DEFAULT_SHADE);
  const [shade, setShade] = useState<Shade>(saved);
  const saveShade = canSaveShade ? () => { send({ type: "save_shade", shade }); setSaved(shade); } : undefined;
  const [view, setView] = useState<View>(normalizeStyle(style) ?? "story");
  const [tab, setTab] = useState<"teeth" | "xrays">("teeth");
  const [look, setLook] = useState<ChartLook>(askedLook ?? "rows");
  const [dentition, setDentition] = useState<ChartDentition>(askedDentition ?? "adult");
  const [edited, setEdited] = useState<ReadonlyMap<string, readonly XrayPin[]>>(new Map());
  const hasXray = xrays !== undefined && xrays.length > 0;
  const options = useMemo(() => styleOptions(betas, style), [betas, style]);
  const model = useMemo(() => presentFacts(snapshot), [snapshot]);
  const pins: XrayPins = {
    of: (id) => edited.get(id) ?? xrays?.find((x) => x.id === id)?.pins ?? [],
    set: canWrite ? (id, next) => {
      setEdited(new Map(edited).set(id, next));
      send({ type: "save_pins", attachment_id: id, pins: next.map((p) => ({ tooth: p.tooth, x: p.x, y: p.y, ...(p.label == null ? {} : { label: p.label }) })) });
    } : undefined,
  };
  preloadArt(snapshot);
  useImperativeHandle(controls, () => ({
    back: () => {
      if (brushing) {
        setBrushing(false);
        return true;
      }
      if (!detail.current) return false;
      detail.current = false;
      // MouthView's own Back: Esc returns to the overview (m4).
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
      return true;
    },
  }), [brushing]);
  const theme = isDark ? "dark" : "light";
  const wait = <p role="status" className="pm-wait">Loading…</p>;
  return (
    <StudioProvider studio={studio}>
    <PinsProvider>
    <div className="pm-shell mv-theme" data-mv-theme={theme} role="dialog" aria-modal="true" aria-label="Present mode">
      <header className="pm-bar">
        <div className="pm-who">
          Show patient
        </div>
        {xrays === undefined ? null : (
          <div className="pm-tabs" role="tablist" aria-label="Show">
            {(["teeth", "xrays"] as const).map((t) => (
              <button key={t} type="button" role="tab" className="pm-tab" aria-selected={tab === t} onClick={() => { setTab(t); }}>{t === "teeth" ? "Teeth" : "X-rays"}</button>
            ))}
          </div>
        )}
        {tab === "teeth" ? (
          <Suspense fallback={<span className="pm-chip pm-morechip" aria-hidden="true">More</span>}>
            <MoreMenu
              looks={options} look={view === "chart" ? style : view} onLook={(v) => { if (isStyle(v) && isShipped(v)) setView(v); }}
              chart={chart === undefined ? undefined : {
                active: view === "chart", onActive: (on) => { setView(on ? "chart" : style); },
                looks: LOOKS, look, onLook: (v) => { const l = LOOKS.find((x) => x.value === v); if (l !== undefined) setLook(l.value); },
                dentitions: DENTITIONS, dentition, onDentition: (v) => { const d = DENTITIONS.find((x) => x.value === v); if (d !== undefined) setDentition(d.value); },
              }}
              onlyToday={onlyToday} onOnlyToday={setOnlyToday}
              orientation={orientation} onOrientation={setOrientation}
              shade={shade} onShade={setShade} shadeDirty={shade !== saved} onSaveShade={saveShade}
              dark={isDark} onDark={setDark2}
              onBrush={() => { setBrushing(true); }}
              onMakeDefault={view !== "chart" && view !== style ? () => { send({ type: "make_default", style: view }); } : undefined}
            />
          </Suspense>
        ) : null}
        {tab === "teeth" ? <PinnedGate studio={studio} saved={discussions} canWrite={canWrite} send={send} /> : null}
        <HoldToExit onExit={() => { send({ type: "exit" }); }} />
      </header>
      <div className="pm-body" hidden={tab !== "teeth"}>
        <MouthView
          snapshot={snapshot}
          mode="present"
          filter={onlyToday ? "today" : undefined}
          doctorLines={false}
          load3d={load3d}
          onScreen={(s) => { detail.current = s === "detail"; }}
          overview={view === "chart" && chart !== undefined ? (slot) => (
            <Suspense fallback={wait}><PresentChart look={look} dentition={dentition} chart={chart} planItems={[]} slot={slot} /></Suspense>
          ) : view === "story" ? (slot) => (
            <StorySlot
              model={model} slot={slot} orientation={orientation} onOrientation={setOrientation} shade={shade} theme={theme} load3d={load3d} plans={plans}
              xray={hasXray && xrays[0] !== undefined ? <Suspense fallback={wait}><StoryXrayPicture xray={xrays[0]} /></Suspense> : undefined}
            />
          ) : (slot) => (
            <PaintedSlot model={model} slot={slot} orientation={orientation} onOrientation={setOrientation} shade={shade} onShade={setShade} shadeDirty={shade !== saved} onSaveShade={saveShade} theme={theme} />
          )}
          toothExtras={(tooth) => (needsDepth(snapshot, tooth) ? (
            <button type="button" className="pm-chip pm-depth" onClick={() => { send({ type: "add_depth", tooth }); }}>
              <span className="pm-depth-label">Add depth</span>
            </button>
          ) : null)}
        />
      </div>
      {tab === "xrays" && xrays !== undefined ? (
        <div className="pm-body pm-body-xrays">
          <Suspense fallback={wait}><XraysTab xrays={xrays} pins={pins} /></Suspense>
        </div>
      ) : null}
      {brushing ? (
        <Suspense fallback={null}>
          <BrushingPanel band={brushingBand(snapshot)} name={undefined} onClose={() => { setBrushing(false); }} />
        </Suspense>
      ) : null}
    </div>
    </PinsProvider>
    </StudioProvider>
  );
}
