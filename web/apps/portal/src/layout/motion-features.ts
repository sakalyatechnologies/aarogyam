/**
 * Motion's animation features, loaded after the first paint. `domMax` adds layout animations
 * (the rail's sliding active bar uses `layoutId`); importing it lazily keeps it out of the main chunk.
 */
export function loadMotionFeatures() {
  return import("./motion-dom-max.js").then((module) => module.default);
}
