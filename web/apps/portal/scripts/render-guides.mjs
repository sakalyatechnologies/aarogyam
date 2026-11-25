// Renders the narrated guides (docs/plans/guides-design.md §3): `pnpm guides:render [id…]`.
// Starts the portal on the fake API, plays each guide's steps in Chromium (Playwright), saves a 1366x768 WebP still
// and the highlight box per step, speaks the narration locally (Kokoro, else macOS `say`), and writes
// public/guides/<id>/{guide.json,NN.webp,NN.m4a} plus public/guides/index.json.
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const guidesDir = join(root, "guides");
const outRoot = join(root, "public", "guides");
const PORT = 5251;
const BASE = `http://127.0.0.1:${String(PORT)}`;
const PLAYWRIGHT = process.env["PLAYWRIGHT_MODULE"] ?? "/Users/neketpatil/project/aarogyam/web/e2e/node_modules/@playwright/test/index.mjs";
const KOKORO_PYTHON = join(homedir(), "project/.venvs/kokoro/bin/python");
const GUIDE_BUDGET = 2 * 1024 * 1024;
const TOTAL_BUDGET = 25 * 1024 * 1024;
const SAY_VOICE = process.env["GUIDES_SAY_VOICE"] ?? "Aman";
const SETTLE_MS = 700;

const fail = (message) => {
  throw new Error(message);
};

async function loadGuides(only) {
  const files = readdirSync(guidesDir).filter((f) => f.endsWith(".guide.ts")).sort();
  const guides = [];
  for (const file of files) {
    const mod = await import(pathToFileURL(join(guidesDir, file)).href);
    guides.push(mod.guide);
  }
  for (const id of only) if (!guides.some((g) => g.id === id)) fail(`No guide with id "${id}". Known: ${guides.map((g) => g.id).join(", ")}`);
  return { all: guides, chosen: only.length === 0 ? guides : guides.filter((g) => only.includes(g.id)) };
}

async function startPortal() {
  const child = spawn("pnpm", ["exec", "vite", "--port", String(PORT), "--strictPort"], {
    cwd: root,
    env: { ...process.env, VITE_API_MODE: "fake" },
    stdio: "ignore",
    detached: true,
  });
  const stop = () => {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      // Already gone.
    }
  };
  process.on("exit", stop);
  for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => process.exit(1));
  for (let i = 0; i < 120; i++) {
    try {
      const res = await fetch(`${BASE}/sign-in`);
      if (res.ok) return stop;
    } catch {
      // Not up yet.
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  stop();
  return fail(`The portal did not start on ${BASE} within 2 minutes (is port ${String(PORT)} free?)`);
}

/** Speaks every line of one guide. Returns the m4a path per step. */
function speak(guide, dir) {
  // A guide whose lines were all spoken before (same voice, same words) reuses that audio, so re-rendering after a UI change is quick.
  const cacheDir = join(tmpdir(), "aarogyam-guides-tts");
  mkdirSync(cacheDir, { recursive: true });
  const voiceKey = process.env["GUIDES_TTS"] === "say" || !existsSync(KOKORO_PYTHON) ? `say-${SAY_VOICE}` : `kokoro-${process.env["GUIDES_KOKORO_VOICE"] ?? "af_heart"}`;
  const keyOf = (text) => join(cacheDir, createHash("sha1").update(`${voiceKey}|${text}`).digest("hex"));
  const cached = guide.steps.map((step) => existsSync(`${keyOf(step.narration)}.m4a`));
  if (cached.every(Boolean)) {
    return {
      engine: voiceKey,
      seconds: guide.steps.map((step, i) => {
        copyFileSync(`${keyOf(step.narration)}.m4a`, join(dir, `${pad(i)}.m4a`));
        return Number(readFileSync(`${keyOf(step.narration)}.sec`, "utf8"));
      }),
    };
  }
  const useKokoro = process.env["GUIDES_TTS"] !== "say" && existsSync(KOKORO_PYTHON);
  const jobs = guide.steps.map((step, i) => ({ text: step.narration, wav: join(dir, `${pad(i)}.wav`), m4a: join(dir, `${pad(i)}.m4a`) }));
  if (useKokoro) {
    const jobsFile = join(tmpdir(), `guide-${guide.id}-jobs.json`);
    writeFileSync(jobsFile, JSON.stringify(jobs.map((j) => ({ text: j.text, out: j.wav }))));
    const run = spawnSync(KOKORO_PYTHON, [join(root, "scripts", "kokoro-say.py"), jobsFile, process.env["GUIDES_KOKORO_VOICE"] ?? "af_heart"], { stdio: ["ignore", "ignore", "ignore"], env: { ...process.env, PYTHONWARNINGS: "ignore", HF_HUB_DISABLE_PROGRESS_BARS: "1" } });
    if (run.status !== 0) fail("Kokoro failed; rerun with GUIDES_TTS=say to use the macOS voice.");
  } else {
    for (const job of jobs) {
      const aiff = job.wav.replace(/\.wav$/, ".aiff");
      const run = spawnSync("say", ["-v", SAY_VOICE, "-o", aiff, job.text]);
      if (run.status !== 0) fail(`say failed for "${job.text.slice(0, 30)}"`);
      job.wav = aiff;
    }
  }
  const seconds = [];
  for (const job of jobs) {
    const conv = spawnSync("afconvert", [job.wav, job.m4a, "-f", "m4af", "-d", "aac", "-b", "32000", "-c", "1"]);
    if (conv.status !== 0) fail(`afconvert failed: ${String(conv.stderr)}`);
    rmSync(job.wav);
    const info = spawnSync("afinfo", [job.m4a]).stdout.toString();
    const m = /estimated duration: ([\d.]+) sec/.exec(info);
    if (m === null) fail(`afinfo gave no duration for ${job.m4a}`);
    seconds.push(Math.round(Number(m[1]) * 10) / 10);
  }
  guide.steps.forEach((step, i) => {
    copyFileSync(jobs[i].m4a, `${keyOf(step.narration)}.m4a`);
    writeFileSync(`${keyOf(step.narration)}.sec`, String(seconds[i]));
  });
  return { engine: useKokoro ? "kokoro" : `say ${SAY_VOICE}`, seconds };
}

const pad = (i) => String(i + 1).padStart(2, "0");

async function settle(page) {
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await page.waitForTimeout(SETTLE_MS);
}

async function toWebp(converter, png) {
  const b64 = await converter.evaluate(async ({ data }) => {
    const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${data}`)).blob());
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext("2d").drawImage(bitmap, 0, 0);
    return canvas.toDataURL("image/webp", 0.7).split(",")[1];
  }, { data: png.toString("base64") });
  return Buffer.from(b64, "base64");
}

async function runAction(page, action) {
  const t = { timeout: 8000 };
  if ("click" in action) await page.locator(action.click).first().click(t);
  else if ("fill" in action) await page.locator(action.fill).first().fill(action.text, t);
  else if ("select" in action) await page.locator(action.select).first().selectOption({ label: action.label }, t);
  else if ("press" in action) await page.keyboard.press(action.press);
  else await page.waitForTimeout(action.wait);
}

async function signIn(page, guide) {
  await page.goto(`${BASE}/sign-in`);
  await page.getByText(guide.as, { exact: false }).first().click({ timeout: 15000 });
  const picker = page.getByText("Choose a clinic");
  await picker.waitFor({ timeout: 3000 }).then(
    async () => page.getByText("Sunrise Dental").first().click(),
    () => undefined,
  );
  await page.waitForURL(/\/today/, { timeout: 15000 });
  await settle(page);
}

async function renderGuide(browser, converter, guide, speech) {
  const dir = join(outRoot, guide.id);
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await page.addInitScript(() => {
    const style = document.createElement("style");
    style.textContent = "*{caret-color:transparent!important}";
    document.addEventListener("DOMContentLoaded", () => document.head.append(style));
  });
  const where = (i, what) => `Guide "${guide.id}", step ${String(i + 1)} "${guide.steps[i].title}": ${what}`;
  await signIn(page, guide).catch((e) => fail(`Guide "${guide.id}": sign-in as ${guide.as} failed: ${e.message.split("\n")[0]}`));
  const steps = [];
  for (const [i, step] of guide.steps.entries()) {
    await settle(page);
    let box;
    if (step.highlight !== undefined) {
      const el = page.locator(step.highlight).first();
      await el.waitFor({ state: "visible", timeout: 8000 }).catch(async () => {
        const shot = join(tmpdir(), `guide-${guide.id}-step-${pad(i)}-fail.png`);
        await page.screenshot({ path: shot }).catch(() => undefined);
        fail(where(i, `nothing matches the highlight ${step.highlight} (page ${page.url()}, screenshot ${shot})`));
      });
      await el.scrollIntoViewIfNeeded();
      await page.waitForTimeout(400);
      const b = await el.boundingBox();
      if (b === null) fail(where(i, `the highlight ${step.highlight} has no box`));
      const x = Math.max(0, b.x), y = Math.max(0, b.y);
      const w = Math.min(1366, b.x + b.width) - x, h = Math.min(768, b.y + b.height) - y;
      const r = (n) => Math.round(n * 10000) / 10000;
      box = { x: r(x / 1366), y: r(y / 768), w: r(w / 1366), h: r(h / 768) };
    }
    const file = `${pad(i)}.webp`;
    writeFileSync(join(dir, file), await toWebp(converter, await page.screenshot({ type: "png" })));
    steps.push({ title: step.title, narration: step.narration, still: file, audio: `${pad(i)}.m4a`, seconds: speech.seconds[i], ...(box === undefined ? {} : { box }) });
    for (const action of step.actions ?? []) {
      await runAction(page, action).catch((e) => fail(where(i, `an action failed (${JSON.stringify(action)}): ${e.message.split("\n")[0]}`)));
      await page.waitForTimeout(300);
    }
  }
  await context.close();
  const seconds = Math.round(steps.reduce((sum, s) => sum + Math.max(3, s.seconds + 0.6), 0));
  const json = { id: guide.id, title: guide.title, role: guide.role, summary: guide.summary, order: guide.order, seconds, steps };
  writeFileSync(join(dir, "guide.json"), `${JSON.stringify(json)}\n`);
  return dir;
}

function sizeOf(dir) {
  return readdirSync(dir).reduce((sum, f) => sum + statSync(join(dir, f)).size, 0);
}

function writeIndex(all) {
  const entries = [];
  for (const g of all) {
    const file = join(outRoot, g.id, "guide.json");
    if (!existsSync(file)) continue;
    const j = JSON.parse(readFileSync(file, "utf8"));
    entries.push({ id: j.id, title: j.title, role: j.role, summary: j.summary, order: j.order, seconds: j.seconds, steps: j.steps.length, still: `${j.id}/${j.steps[0].still}` });
  }
  writeFileSync(join(outRoot, "index.json"), `${JSON.stringify({ guides: entries })}\n`);
}

const only = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const { all, chosen } = await loadGuides(only);
mkdirSync(outRoot, { recursive: true });
const { chromium } = await import(PLAYWRIGHT);
const stopPortal = await startPortal();
let browser;
let failed = false;
try {
  browser = await chromium.launch();
  const converter = await (await browser.newContext()).newPage();
  for (const guide of chosen) {
    rmSync(join(outRoot, guide.id), { recursive: true, force: true });
    mkdirSync(join(outRoot, guide.id), { recursive: true });
    const speech = speak(guide, join(outRoot, guide.id));
    const dir = await renderGuide(browser, converter, guide, speech);
    const bytes = sizeOf(dir);
    console.log(`${guide.id}: ${String(guide.steps.length)} steps, ${(bytes / 1024).toFixed(0)} KB, voice ${speech.engine}`);
    if (bytes > GUIDE_BUDGET) fail(`Guide "${guide.id}" is ${(bytes / 1024).toFixed(0)} KB, over its 2048 KB budget`);
  }
  writeIndex(all);
  const total = readdirSync(outRoot).filter((d) => existsSync(join(outRoot, d, "guide.json"))).reduce((sum, d) => sum + sizeOf(join(outRoot, d)), 0);
  console.log(`total ${(total / 1024 / 1024).toFixed(2)} MB`);
  if (total > TOTAL_BUDGET) fail("The guides together are over the 25 MB budget; move them to R2.");
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  failed = true;
} finally {
  await browser?.close();
  stopPortal();
}
process.exit(failed ? 1 : 0);
