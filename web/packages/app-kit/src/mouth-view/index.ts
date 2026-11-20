// @aarogyam/app-kit/mouth-view: the interactive mouth view (design §1.12) shared by the patient's
// visit page and the doctor's Present mode. Import "./mouth-view.css" next to it.
export { MouthView, preloadArt, type MouthViewProps } from "./mouth-view.js";
export {
  archStates, brushHighlight, brushingBand, dayLabel, detailTitle, mainTreatment, problemWords, spokenLabel, summaryCounts, toothInfo,
  type PositionState, type Snapshot, type SnapTooth,
} from "./model.js";
