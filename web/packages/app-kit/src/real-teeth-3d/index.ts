// @aarogyam/app-kit/real-teeth-3d: the 3D tooth detail (design §1.12, §1.13, phase P10). Load it only
// with a dynamic import: it carries three.js (named imports, inside the 180 KB story budget).
// Procedural geometry, no network fetches. Step ids and detail values match the 2D kit, so the same
// input draws in 2D or 3D; on a `webglunavailable` event the caller falls back to 2D.
export { mountTooth3d, WEBGL_UNAVAILABLE, type Tooth3dHandle, type Tooth3dLabel } from "./render.js";
export {
  resolveScene, typeOfFdi, lookOf, isStep, VIEWS,
  type Tooth3dOptions, type Tooth3dDetails, type Tooth3dStage, type SceneSpec, type View, type Badge, type Cavity, type Look, type Site, type Infection,
} from "./spec.js";
export { buildScene, toothTypeList, KIND_ORDER, QUALITY, type Built, type Kind, type Layer, type Quality } from "./build.js";
