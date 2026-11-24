// Present mode on the phone (design §1.12 "Phone parity"): the portal's Show patient shell around the
// same MouthView, fed the `/visits/{id}/mouth` JSON by the app. It opens on the painted map, the web's
// default style (present-studio-design slice 1a), drawn from the same facts; the chart look needs the
// dental chart, which the bridge doesn't carry. No API calls: "Add depth" and Exit go
// back to the app over the bridge, which owns saving and leaving.
import { Brush } from "lucide-react";
import { Suspense, lazy, useImperativeHandle, useMemo, useRef, useState, type ReactElement, type Ref } from "react";

import type { MouthSnapshot, PresentStudio } from "@aarogyam/api-client";
import { MouthView, brushingBand, preloadArt } from "@aarogyam/app-kit/mouth-view";
import {
  DEFAULT_SHADE, HoldToExit, PRESENT_STYLES, PaintedSlot, StorySlot, StudioProvider, StyleSwitcher, isShipped, presentFacts,
  type Orientation, type PresentStyleId, type Shade, type SwitcherOption,
} from "@aarogyam/app-kit/present";

import type { PageMessage } from "./channel.js";

const load3d = () => import("@aarogyam/app-kit/real-teeth-3d");
const BrushingPanel = lazy(() => import("@aarogyam/app-kit/present/brushing-panel").then((m) => ({ default: m.BrushingPanel })));

/** What native's `back()` asks of the screen; the page answers whether it went back. */
export interface PresentControls {
  back(): boolean;
}

export const isStyle = (v: unknown): v is PresentStyleId => PRESENT_STYLES.some((s) => s.id === v);

/** Own X-ray needs the portal's attachments and signed links, so the phone offers story, painted and any beta the app lists. */
export function styleOptions(betas: readonly string[], saved: PresentStyleId): SwitcherOption[] {
  const ids = new Set<PresentStyleId>(["story", "painted"]);
  for (const b of betas) if (isStyle(b) && b !== "xray") ids.add(b);
  return PRESENT_STYLES.filter((x) => ids.has(x.id)).map((x) => ({
    id: x.id, label: x.label, beta: x.beta, note: x.id === saved ? "Default" : undefined, disabled: isShipped(x.id) ? undefined : "Coming soon",
  }));
}

/** Caries recorded without a depth: the app records it (§1.13), so the chip only names the tooth. */
export function needsDepth(snapshot: MouthSnapshot, tooth: number): boolean {
  const t = snapshot.teeth.find((x) => x.tooth === tooth);
  return t !== undefined && (t.problems ?? []).includes("caries") && t.details?.caries_depth === undefined;
}

export function PresentApp({ snapshot, dark, send, controls, style, studio, betas = [] }: {
  snapshot: MouthSnapshot;
  dark: boolean;
  /** The opening style, also the doctor's saved default. */
  style: PresentStyleId;
  /** The parsed `/visits/{id}/present` JSON; undefined opens without options. */
  studio?: PresentStudio | undefined;
  betas?: readonly string[];
  send: (m: PageMessage) => void;
  controls: Ref<PresentControls>;
}): ReactElement {
  const [brushing, setBrushing] = useState(false);
  const [onlyToday, setOnlyToday] = useState(false);
  const detail = useRef(false);
  const [orientation, setOrientation] = useState<Orientation>("mirror");
  const [shade, setShade] = useState<Shade>(DEFAULT_SHADE);
  const [view, setView] = useState<PresentStyleId>(style);
  const options = useMemo(() => styleOptions(betas, style), [betas, style]);
  const model = useMemo(() => presentFacts(snapshot), [snapshot]);
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
  return (
    <StudioProvider studio={studio}>
    <div className="pm-shell mv-theme" data-mv-theme={dark ? "dark" : "light"} role="dialog" aria-modal="true" aria-label="Present mode">
      <header className="pm-bar">
        <div className="pm-who">
          Show patient
          <small>The same mouth view as the patient's page</small>
        </div>
        <StyleSwitcher options={options} value={view} onChange={(v) => { if (isStyle(v) && isShipped(v)) setView(v); }} />
        {view !== style && (view === "story" || view === "painted" || view === "smile3d" || view === "face") ? (
          <button type="button" className="pm-chip" onClick={() => { send({ type: "make_default", style: view }); }}>
            Make default
          </button>
        ) : null}
        <button type="button" className="pm-chip pm-today" aria-pressed={onlyToday} onClick={() => { setOnlyToday(!onlyToday); }}>
          Today
        </button>
        <button type="button" className="pm-chip pm-brushchip" onClick={() => { setBrushing(true); }}>
          <Brush aria-hidden="true" />
          How to brush
        </button>
        <HoldToExit onExit={() => { send({ type: "exit" }); }} />
      </header>
      <div className="pm-body">
        <MouthView
          snapshot={snapshot}
          mode="present"
          filter={onlyToday ? "today" : undefined}
          load3d={load3d}
          onScreen={(s) => { detail.current = s === "detail"; }}
          overview={view === "story" ? (slot) => (
            <StorySlot model={model} slot={slot} orientation={orientation} onOrientation={setOrientation} theme={dark ? "dark" : "light"} load3d={load3d} />
          ) : (slot) => (
            <PaintedSlot model={model} slot={slot} orientation={orientation} onOrientation={setOrientation} shade={shade} onShade={setShade} theme={dark ? "dark" : "light"} />
          )}
          toothExtras={(tooth) => (needsDepth(snapshot, tooth) ? (
            <button type="button" className="pm-chip pm-depth" onClick={() => { send({ type: "add_depth", tooth }); }}>
              <span className="pm-depth-label">Add depth</span>
            </button>
          ) : null)}
        />
      </div>
      {brushing ? (
        <Suspense fallback={null}>
          <BrushingPanel band={brushingBand(snapshot)} name={undefined} onClose={() => { setBrushing(false); }} />
        </Suspense>
      ) : null}
    </div>
    </StudioProvider>
  );
}
