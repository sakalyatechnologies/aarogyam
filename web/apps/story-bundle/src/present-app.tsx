// Present mode on the phone (design §1.12 "Phone parity"): the portal's Show patient shell around the
// same MouthView, fed the `/visits/{id}/mouth` JSON by the app. No API calls: "Add depth" and Exit go
// back to the app over the bridge, which owns saving and leaving.
import { Brush } from "lucide-react";
import { Suspense, lazy, useImperativeHandle, useRef, useState, type ReactElement, type Ref } from "react";

import type { MouthSnapshot } from "@aarogyam/api-client";
import { MouthView, brushingBand, preloadArt } from "@aarogyam/app-kit/mouth-view";
import { HoldToExit } from "@aarogyam/app-kit/present";

import type { PageMessage } from "./channel.js";

const load3d = () => import("@aarogyam/app-kit/real-teeth-3d");
const BrushingPanel = lazy(() => import("@aarogyam/app-kit/present/brushing-panel").then((m) => ({ default: m.BrushingPanel })));

/** What native's `back()` asks of the screen; the page answers whether it went back. */
export interface PresentControls {
  back(): boolean;
}

/** Caries recorded without a depth: the app records it (§1.13), so the chip only names the tooth. */
export function needsDepth(snapshot: MouthSnapshot, tooth: number): boolean {
  const t = snapshot.teeth.find((x) => x.tooth === tooth);
  return t !== undefined && (t.problems ?? []).includes("caries") && t.details?.caries_depth === undefined;
}

export function PresentApp({ snapshot, dark, send, controls }: {
  snapshot: MouthSnapshot;
  dark: boolean;
  send: (m: PageMessage) => void;
  controls: Ref<PresentControls>;
}): ReactElement {
  const [brushing, setBrushing] = useState(false);
  const [onlyToday, setOnlyToday] = useState(false);
  const detail = useRef(false);
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
    <div className="pm-shell mv-theme" data-mv-theme={dark ? "dark" : "light"} role="dialog" aria-modal="true" aria-label="Present mode">
      <header className="pm-bar">
        <div className="pm-who">
          Show patient
          <small>The same mouth view as the patient's page</small>
        </div>
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
  );
}
