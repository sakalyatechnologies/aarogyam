// @aarogyam/app-kit/mouth-view: the interactive mouth view (design §1.12) shared by the patient's
// visit page and the doctor's Present mode. Import "./mouth-view.css" next to it.
export { BadgeIcon, MouthView, preloadArt, type MouthViewProps, type OverviewSlot } from "./mouth-view.js";
export {
  archStates, brushHighlight, isRecommended, isToday, stateFor, brushingBand, dayLabel, detailTitle, mainTreatment, problemWords, spokenLabel, summaryCounts, toothInfo,
  type PositionState, type Snapshot, type SnapTooth,
} from "./model.js";
