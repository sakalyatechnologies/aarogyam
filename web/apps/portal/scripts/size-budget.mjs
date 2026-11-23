// The patient page's lazy budgets (design §1.4, DT6), read from the Vite manifest. Pure, so a test
// can feed it a made-up manifest; check-shared-size.mjs runs it on the real build.

export const KB = 1024;
/** Each lazy brushing band chunk. */
export const BAND_BYTES = 8 * KB;
/** The 3D story chunks (the module and what only it loads), together. */
export const STORY_BYTES = 180 * KB;

/**
 * @typedef {{ file: string; src?: string; isDynamicEntry?: boolean; imports?: string[]; dynamicImports?: string[] }} Chunk
 * @param {{ manifest: Record<string, Chunk>; entry: string; gz: (file: string) => number; preloaded: string[] }} input
 * @returns {{ failures: string[]; bands: Record<string, number>; story: number; lazy: Record<string, number> }}
 */
export function lazyBudget({ manifest, entry, gz, preloaded }) {
  const failures = [];
  const start = manifest[entry];
  if (start === undefined) return { failures: [`no ${entry} in the manifest`], bands: {}, story: 0, lazy: {} };
  // everything the entry loads up front
  const eager = new Set();
  const walkEager = (key) => {
    const c = manifest[key];
    if (c === undefined || eager.has(key)) return;
    eager.add(key);
    for (const k of c.imports ?? []) walkEager(k);
  };
  walkEager(entry);
  // each dynamic entry reachable from the page, with the chunks only it pulls in
  const dynamic = new Set();
  const walkDynamic = (key, seen = new Set()) => {
    const c = manifest[key];
    if (c === undefined || seen.has(key)) return;
    seen.add(key);
    for (const k of c.dynamicImports ?? []) if (!eager.has(k)) { dynamic.add(k); walkDynamic(k, seen); }
    for (const k of c.imports ?? []) walkDynamic(k, seen);
  };
  walkDynamic(entry);
  const closure = (key) => {
    const out = new Set();
    const go = (k) => {
      if (out.has(k) || eager.has(k) || manifest[k] === undefined) return;
      out.add(k);
      for (const i of manifest[k].imports ?? []) go(i);
    };
    go(key);
    return out;
  };
  const lazy = {};
  const bands = {};
  let story = 0;
  const storyFiles = new Set();
  for (const key of dynamic) {
    const c = manifest[key];
    const size = gz(c.file);
    lazy[c.src ?? key] = size;
    const band = /\/gen\/brushing\/([a-z0-9_]+)\./.exec(c.src ?? key)?.[1];
    if (band !== undefined) {
      bands[band] = size;
      if (size > BAND_BYTES) failures.push(`brushing-${band} is ${(size / KB).toFixed(1)} KB gzipped, over ${String(BAND_BYTES / KB)} KB`);
    }
    if (/real-teeth-3d\/index\./.test(c.src ?? key)) for (const k of closure(key)) storyFiles.add(manifest[k].file);
  }
  for (const f of storyFiles) story += gz(f);
  if (story > STORY_BYTES) failures.push(`the 3D story chunks are ${(story / KB).toFixed(1)} KB gzipped, over ${String(STORY_BYTES / KB)} KB`);
  for (const key of dynamic) {
    const file = manifest[key].file;
    if (preloaded.some((p) => p.endsWith(file))) failures.push(`${file} is lazy but shared.html preloads it`);
  }
  return { failures, bands, story, lazy };
}

// Show patient (present-studio-design §13): the Present route with the shared model and blocks, the
// painted style with its front atlas, and what Show patient prefetches for a visit.
/** The Present route chunk with the present model and shared blocks (§13). */
export const PRESENT_ROUTE_BYTES = 40 * KB;
/**
 * Everything the Present route loads beyond the portal shell. It was 44.3 KB before slice 1a (MouthView,
 * the tooth art kit and the chart prefs); the §13 40 KB covers the route's own code, checked above.
 * 54 KB since slices 2a-3b (23 Nov 2026): the options studio and the five style entry points; their
 * heavy parts (three.js, the 3D meshes, materials and usual plans) still load only when opened.
 */
export const PRESENT_ROUTE_ALL_BYTES = 54 * KB;
/** The painted style: its code (15 KB) and the front atlas (50 KB), in one chunk. */
export const PAINTED_BYTES = 65 * KB;
/** Everything Show patient prefetches for the painted style. */
export const PRESENT_PREFETCH_BYTES = 180 * KB;

/**
 * @param {{ manifest: Record<string, Chunk>; entry: string; gz: (file: string) => number; art: RegExp }} input
 *   `art`: the tooth-art sources a visit prefetches (its recorded tooth types and the shared shapes).
 * @returns {{ failures: string[]; own: number; route: number; painted: number; art: number; prefetch: number }}
 */
export function presentBudget({ manifest, entry, gz, art }) {
  const failures = [];
  const keyOf = (re) => Object.keys(manifest).find((k) => re.test(manifest[k].src ?? k));
  const eager = new Set();
  const walk = (key, into, skip) => {
    const c = manifest[key];
    if (c === undefined || into.has(key) || skip.has(key)) return;
    into.add(key);
    for (const k of c.imports ?? []) walk(k, into, skip);
  };
  walk(entry, eager, new Set());
  const size = (keys) => [...keys].reduce((sum, k) => sum + gz(manifest[k].file), 0);
  const routeKey = keyOf(/pages\/visits\/present\/present-page\.tsx$/);
  const paintedKey = keyOf(/app-kit\/src\/present\/painted\.tsx$/);
  if (routeKey === undefined || paintedKey === undefined) return { failures: ["no Present route or painted style in the manifest"], own: 0, route: 0, painted: 0, art: 0, prefetch: 0 };
  const route = new Set();
  walk(routeKey, route, eager);
  const painted = new Set();
  walk(paintedKey, painted, new Set([...eager, ...route]));
  const artKeys = new Set(Object.keys(manifest).filter((k) => art.test(manifest[k].src ?? k) && !eager.has(k) && !route.has(k)));
  // the route chunk and app-kit/present's shared chunks (Vite names a shared chunk after its first module)
  const own = new Set([...route].filter((k) => /pages\/visits\/present\/present-page\.tsx$|app-kit\/src\/present\//.test(manifest[k].src ?? "") || /^_(blocks|present)-/.test(k)));
  const out = { failures, own: size(own), route: size(route), painted: size(painted), art: size(artKeys), prefetch: 0 };
  out.prefetch = out.route + out.painted + out.art;
  const over = (what, bytes, budget) => { if (bytes > budget) failures.push(`${what} is ${(bytes / KB).toFixed(1)} KB gzipped, over ${String(budget / KB)} KB`); };
  over("the Present route's own code", out.own, PRESENT_ROUTE_BYTES);
  over("the Present route with what it loads", out.route, PRESENT_ROUTE_ALL_BYTES);
  over("the painted style", out.painted, PAINTED_BYTES);
  over("Show patient's prefetch", out.prefetch, PRESENT_PREFETCH_BYTES);
  return out;
}
