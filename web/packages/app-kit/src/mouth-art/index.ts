// @aarogyam/app-kit/mouth-art: the 2D art kit for the interactive mouth view (design §1.4, §1.12,
// §1.13). Framework-free data and scene builders, two renderers (SVG string, canvas Path2D) and
// tiny React wrappers. Art chunks load lazily per tooth type, treatment model and brushing band.
export type * from "./types.js";
export { TOOTH_TYPES } from "./types.js";
export { SHADES, shadeForAge, paintColor, type Shade } from "./palette.js";
export {
  MM, composeLayers, isMirrored, placement, stagePart, toothScene, SceneBuilder,
  type LayerParams, type ScenePart, type ToothSceneOptions,
} from "./scene.js";
export { overlayPart, materialPaint, viewsForSurface, MATERIAL_LOOKS, type Overlay, type Surface, type CariesDepth } from "./overlays.js";
export { eruptionScene, eruptionKey, type Eruption, type Angulation, type EruptionOptions } from "./eruption.js";
export { sceneToSvg, drawScene, type Canvas2D, type CanvasDrawOptions, type PathLike, type SvgStringOptions } from "./render.js";
export { loadToothArt, loadStageArt, loadBrushingArt, loadShapes, toothTypeOf, neighborOf } from "./loaders.js";
export { STAGE_STEPS, STAGE_MODELS, EXTRA_SCENES, BRUSHING_BANDS, DETAIL_VALUES, DETAIL_CHIPS, SCENE_ART, STAGE_CALLOUTS, sceneArt, type StageModel, type BrushingBand } from "./stage-steps.js";
export { BAND_INFO, PHASE_CAPTION, LOOP_MS, brushingPose, brushingScene, type BrushPose, type BrushPhase, type BandInfo } from "./brushing.js";
export { resolveArt, ART_MAP, type ArtRef } from "./art-map.js";
export { ArtSvg, BrushingAnimation, type ArtSvgProps, type BrushingAnimationProps } from "./react.js";
export { archLayout, TOOTH_WIDTH_MM, TOOTH_DEPTH_MM, type ArchSlot, type ArchLayoutOptions } from "./arch.js";
