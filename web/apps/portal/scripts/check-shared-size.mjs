// Fails the build when the patient-link page grows past its budgets (docs/plans/visit-story-v2-offers-design.md §1.4).
// 1. Entry: dist/shared.html and everything it loads up front, at most 120 KB gzipped.
// 2. Lazy (from the Vite manifest): each brushing band chunk at most 8 KB, the 3D story chunks at most 180 KB together,
//    and no lazy chunk preloaded by shared.html. Patients open the page from WhatsApp on slow phones.
import { readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

import { lazyBudget, presentBudget } from "./size-budget.mjs";

const BUDGET_BYTES = 120 * 1024;
const dist = join(dirname(fileURLToPath(import.meta.url)), "..", "dist");
const html = readFileSync(join(dist, "shared.html"), "utf8");
const assets = [...new Set([...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((match) => match[1]))];
const gz = (file) => gzipSync(readFileSync(join(dist, file))).length;
let total = gzipSync(html).length;
for (const asset of assets) total += gz(asset);
const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;
let failed = false;
if (total > BUDGET_BYTES) {
  console.error(`shared.html loads ${kb(total)} gzipped, over its ${kb(BUDGET_BYTES)} budget: ${assets.join(", ")}`);
  failed = true;
} else {
  console.log(`shared.html: ${kb(total)} gzipped (budget ${kb(BUDGET_BYTES)})`);
}

const manifest = JSON.parse(readFileSync(join(dist, ".vite", "manifest.json"), "utf8"));
// Show patient (present-studio-design §13): the Present route, the painted style and what Show patient
// prefetches for the Aarav fixture (its tooth types and the shapes).
const present = presentBudget({ manifest, entry: "index.html", gz, art: /\/gen\/(teeth\/(u1|pu5|pl5)|shapes)\./ });
for (const failure of present.failures) console.error(`Present budget: ${failure}`);
if (present.failures.length > 0) failed = true;
console.log(`Present: route code ${kb(present.own)} (budget 40 KB), with what it loads ${kb(present.route)} (budget 52 KB), painted style ${kb(present.painted)} (budget 65 KB), prefetch for Aarav ${kb(present.prefetch)} (budget 180 KB)`);
// The manifest names source files; it is only for this check, so it is not deployed.
rmSync(join(dist, ".vite"), { recursive: true, force: true });
const lazy = lazyBudget({ manifest, entry: "shared.html", gz, preloaded: assets });
for (const failure of lazy.failures) console.error(`shared.html lazy budget: ${failure}`);
if (lazy.failures.length > 0) failed = true;
const bands = Object.entries(lazy.bands).map(([band, size]) => `${band} ${kb(size)}`).join(", ");
console.log(`shared.html lazy: 3D story ${kb(lazy.story)} (budget 180 KB); brushing ${bands} (budget 8 KB each)`);
// What the Aarav fixture opens: its tooth types, stage models, shapes and band (§1.12 size, measured here).
const aarav = Object.entries(lazy.lazy).filter(([src]) => /\/gen\/(teeth\/(u1|pu5|pl5)|stages\/(root_canal|filling|crown)|brushing\/general_6_12|shapes)\./.test(src));
console.log(`shared.html lazy for the Aarav fixture: ${kb(aarav.reduce((sum, [, size]) => sum + size, 0))} over ${String(aarav.length)} chunks`);
if (failed) process.exit(1);
