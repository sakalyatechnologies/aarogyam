// Builds the learn site into dist/ for the assets-only Worker (deploy/cloudflare/learn).
// Usage: LEARN_ORIGIN=https://learn.<root> node scripts/build.mjs
// Without LEARN_ORIGIN it builds for the placeholder host, which is fine for checks only.
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildSite } from "../src/site.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const app = path.resolve(here, "..");
const dental = path.resolve(app, "../../../specialties/dental");
const read = (file) => JSON.parse(fs.readFileSync(path.join(dental, file), "utf8"));

const origin = process.env["LEARN_ORIGIN"] ?? "https://learn.aarogyam.example";
const topics = read("learn-topics.json");
const files = buildSite(origin, topics, read("learn-pages.json"));

const out = path.join(app, "dist");
fs.rmSync(out, { recursive: true, force: true });
for (const [name, file] of files) {
  const target = path.join(out, name);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if ("text" in file) {
    fs.writeFileSync(target, file.text);
    continue;
  }
  const bytes = fs.readFileSync(path.join(app, "stills", file.still));
  const hash = createHash("sha256").update(bytes).digest("hex");
  if (!name.includes(`.${hash.slice(0, 10)}.`)) throw new Error(`${file.still} does not match the manifest; rerun render-stills`);
  fs.writeFileSync(target, bytes);
}
console.log(`learn site: ${files.size} files for ${origin} in ${path.relative(process.cwd(), out)}`);
