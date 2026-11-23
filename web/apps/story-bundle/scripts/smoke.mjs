#!/usr/bin/env node
// Smoke test of the built bundle in headless Chromium, the way the Android app hosts it: dist/ served
// at /story/ on a local static server, a stand-in `AarogyamBridge` collecting the page's messages,
// then `present` with the Aarav fixture (tooth 21, back, back) and `render` of a story to an MP4.
//
//   pnpm --filter @aarogyam/story-bundle build && node web/apps/story-bundle/scripts/smoke.mjs
//
// Needs playwright-core and its Chromium (set PLAYWRIGHT_CORE to the package directory if it isn't
// found under node_modules/.pnpm). SMOKE_SHOT=<file.png> saves a screenshot of Present. Exits
// non-zero on any failed check.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const app = join(dirname(fileURLToPath(import.meta.url)), "..");
const repo = join(app, "..", "..", "..");
const dist = join(app, "dist");
if (!existsSync(join(dist, "index.html"))) throw new Error("dist/ is missing: run the build first");

function playwrightCore() {
  if (process.env.PLAYWRIGHT_CORE) return process.env.PLAYWRIGHT_CORE;
  for (const root of [repo, join(repo, "..", "..", "..")]) {
    const pnpmDir = join(root, "node_modules", ".pnpm");
    if (!existsSync(pnpmDir)) continue;
    const hit = readdirSync(pnpmDir).filter((d) => d.startsWith("playwright-core@")).sort().at(-1);
    if (hit !== undefined) return join(pnpmDir, hit, "node_modules", "playwright-core");
  }
  throw new Error("playwright-core not found; set PLAYWRIGHT_CORE");
}
const { chromium } = await import(pathToFileURL(join(playwrightCore(), "index.mjs")).href);

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".glb": "model/gltf-binary" };
const external = [];
const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (!url.pathname.startsWith("/story/")) { res.writeHead(404).end(); return; }
  const file = normalize(join(dist, url.pathname.slice("/story/".length) || "index.html"));
  if (!file.startsWith(dist) || !existsSync(file)) { res.writeHead(404).end(); return; }
  res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" }).end(readFileSync(file));
});
await new Promise((resolve) => { server.listen(0, "127.0.0.1", resolve); });
const address = server.address();
const origin = `http://127.0.0.1:${String(typeof address === "object" && address !== null ? address.port : 0)}`;

const fixture = JSON.parse(readFileSync(join(repo, "specialties", "dental", "fixtures", "mouth-aarav.json"), "utf8")).snapshot;
const story = { story_version: 1, visit_number: "V-318", visited_on: "2026-11-19", clinic_name: "Sunrise Dental Care", next_visit: "2026-11-26", chart: fixture };

const failures = [];
const check = (ok, what) => { process.stdout.write(`${ok ? "ok  " : "FAIL"} ${what}\n`); if (!ok) failures.push(what); };

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2 });
  const errors = [];
  page.on("pageerror", (e) => { errors.push(String(e)); });
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("request", (r) => { if (!r.url().startsWith(origin) && !r.url().startsWith("data:") && !r.url().startsWith("blob:")) external.push(r.url()); });
  // The Android host's @JavascriptInterface, as the page sees it.
  await page.addInitScript(() => {
    window.__messages = [];
    window.AarogyamBridge = { post: (text) => { window.__messages.push(JSON.parse(text)); } };
  });
  const messages = () => page.evaluate(() => window.__messages);
  const t0 = Date.now();
  await page.goto(`${origin}/story/index.html`);
  await page.waitForFunction(() => window.__messages.some((m) => m.type === "ready"));
  const ready = (await messages()).find((m) => m.type === "ready");
  check(ready?.bundle_version === 1, `ready with bundle_version 1 (${String(Date.now() - t0)} ms)`);
  check(await page.evaluate(() => window.isSecureContext), "secure context (localhost stands in for the app origins)");

  await page.evaluate((mouth) => { window.aarogyam.present(mouth, { dark: true }); }, fixture);
  await page.waitForSelector('[data-present-style="painted"] .ps-dot[data-tooth="21"]');
  check(await page.locator('[data-mv-theme="dark"]').count() > 0, "present: dark Present mode");
  check(await page.locator(".ps-dot").count() === 4 && await page.locator("canvas.ps-canvas").count() === 1, "present: the painted map with a dot on each recorded tooth");
  if (process.env.SMOKE_SHOT) await page.screenshot({ path: process.env.SMOKE_SHOT });
  await page.locator('.ps-dot[data-tooth="21"]').click();
  await page.getByRole("heading", { name: "Root canal treatment" }).waitFor();
  check(await page.evaluate(() => window.aarogyam.back()) === true, "back: from tooth 21 to all teeth");
  await page.getByRole("heading", { name: "Root canal treatment" }).waitFor({ state: "detached" });
  check(await page.evaluate(() => window.aarogyam.back()) === false, "back: at the overview, the app leaves");
  await page.getByRole("button", { name: "How to brush" }).click();
  await page.getByRole("button", { name: "Close" }).waitFor();
  check(true, "How to brush opens from its own chunk");
  await page.getByRole("button", { name: "Close" }).click();

  const r0 = Date.now();
  await page.evaluate((s) => { window.aarogyam.render(s); }, story);
  await page.waitForFunction(() => window.__messages.some((m) => m.type === "done" || m.type === "failed"), null, { timeout: 180_000 });
  const all = await messages();
  const end = all.find((m) => m.type === "done" || m.type === "failed");
  if (end?.type === "failed") {
    check(false, `render: failed "${String(end.reason)}"`);
  } else {
    const chunks = all.filter((m) => m.type === "chunk");
    const bytes = Buffer.concat(chunks.map((c) => Buffer.from(c.base64, "base64")));
    const progress = all.filter((m) => m.type === "progress").map((m) => m.value);
    check(progress.length > 2 && progress.at(-1) === 1, `render: ${String(progress.length)} progress messages up to 1`);
    check(chunks.every((c, i) => c.seq === i) && chunks.every((c) => Buffer.from(c.base64, "base64").length <= 512 * 1024), `render: ${String(chunks.length)} chunks in order, 512 KB at most`);
    check(bytes.length === end.bytes, `render: done.bytes ${String(end.bytes)} matches the chunks`);
    check(bytes.subarray(4, 8).toString("latin1") === "ftyp", `render: an MP4 (${(bytes.length / 1024).toFixed(0)} KB in ${String(Date.now() - r0)} ms)`);
  }
  check(errors.length === 0, `no page errors${errors.length === 0 ? "" : `: ${errors.join(" | ")}`}`);
  check(external.length === 0, `no requests outside the bundle${external.length === 0 ? "" : `: ${external.join(", ")}`}`);
} finally {
  await browser.close();
  server.close();
}
if (failures.length > 0) process.exit(1);
