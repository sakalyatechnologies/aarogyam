// Fails the build when the patient-link page (dist/shared.html and everything it loads) grows
// past its budget. Patients open it from WhatsApp on slow phones (docs/plans/visit-story-design.md).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const BUDGET_BYTES = 120 * 1024;
const dist = join(dirname(fileURLToPath(import.meta.url)), "..", "dist");
const html = readFileSync(join(dist, "shared.html"), "utf8");
const assets = [...new Set([...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((match) => match[1]))];
let total = gzipSync(html).length;
for (const asset of assets) {
  total += gzipSync(readFileSync(join(dist, asset))).length;
}
const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;
if (total > BUDGET_BYTES) {
  console.error(`shared.html loads ${kb(total)} gzipped, over its ${kb(BUDGET_BYTES)} budget: ${assets.join(", ")}`);
  process.exit(1);
}
console.log(`shared.html: ${kb(total)} gzipped (budget ${kb(BUDGET_BYTES)})`);
