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
