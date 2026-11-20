#!/usr/bin/env node
// Renders the learn site's generic stills (docs/plans/visit-story-v2-offers-design.md, sections
// 1.8 and 1.9): per topic one og:image JPEG (1200x630, <= 150 KB) and one square share JPEG
// (1080x1080, <= 200 KB), drawn from @aarogyam/app-kit/mouth-art with no patient and no clinic.
// Writes web/apps/learn/stills/<id>.jpg and <id>-square.jpg and the bytes and hashes in
// specialties/dental/learn-topics.json. Run on a developer machine after the copy or the art
// changes, then commit the stills and the manifest.
// Usage: node web/apps/learn/scripts/render-stills.mjs [--only=<id>]
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../../..');
const TOPICS = path.join(REPO, 'specialties/dental/learn-topics.json');
const PAGES = path.join(REPO, 'specialties/dental/learn-pages.json');
const OUT = path.resolve(HERE, '../stills');
const LIMITS = { still: 150 * 1024, square: 200 * 1024 };

const require = createRequire(path.join(REPO, 'web/apps/portal/package.json'));
const vite = await import(require.resolve('vite'));
const entry = path.join(REPO, 'web/packages/app-kit/src/mouth-art/index.ts');
const server = await vite.createServer({ configFile: false, root: path.dirname(entry), logLevel: 'warn', server: { middlewareMode: true, hmr: false }, appType: 'custom' });
const ma = await server.ssrLoadModule(entry);

const topics = JSON.parse(fs.readFileSync(TOPICS, 'utf8'));
const pages = JSON.parse(fs.readFileSync(PAGES, 'utf8')).pages;
const shapes = await ma.loadShapes();

const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/** One SVG per step for a treatment; a single brushing picture for everyday care. */
async function figures(page, id) {
  const { art } = page;
  if (art.brushing) {
    const brushing = await ma.loadBrushingArt(art.brushing);
    const scene = ma.brushingScene(brushing, art.brushing, ma.brushingPose(art.brushing, 0, true));
    return [{ svg: ma.sceneToSvg(scene, { idPrefix: `${id}-b-` }), label: '' }];
  }
  const tooth = await ma.loadToothArt(art.tooth);
  const stages = await ma.loadStageArt(art.model);
  return page.steps.map((step, i) => {
    const sc = stages.scenes[step.scene];
    if (!sc) throw new Error(`${art.model}: no scene ${step.scene}`);
    const scene = ma.toothScene(tooth, sc.view, { shapes, parts: [ma.stagePart(sc, art.params)] });
    return { svg: ma.sceneToSvg(scene, { idPrefix: `${id}-${i}-` }), label: `${i + 1}  ${step.label}` };
  });
}

function html(title, figs, square) {
  const [w, h] = square ? [1080, 1080] : [1200, 630];
  const one = figs.length === 1;
  const grid = square && figs.length === 4;
  const artH = square ? (one ? 640 : grid ? 280 : figs.length > 2 ? 300 : 520) : (one ? 400 : 330);
  const cards = figs.map((f) => `<figure>${f.svg}${f.label ? `<figcaption>${esc(f.label)}</figcaption>` : ''}</figure>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  *{box-sizing:border-box}html,body{margin:0}
  body{width:${w}px;height:${h}px;overflow:hidden;background:linear-gradient(160deg,#F4FAF7 0%,#E3F1EB 100%);font-family:"Helvetica Neue",Arial,system-ui,sans-serif;color:#12332C;display:flex;flex-direction:column;padding:${square ? '72px 64px' : '44px 56px'}}
  .tag{font-size:${square ? 26 : 22}px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#2F7D6B}
  h1{margin:${square ? '14px 0 0' : '8px 0 0'};font-size:${square ? 76 : 58}px;line-height:1.05;font-weight:800;letter-spacing:-.01em}
  .row{flex:1;display:${grid ? 'grid;grid-template-columns:repeat(2,auto)' : 'flex;flex-wrap:wrap'};align-content:center;justify-content:center;justify-items:center;gap:${square ? 28 : 22}px;margin-top:${square ? 36 : 18}px}
  figure{margin:0;background:#fff;border-radius:28px;box-shadow:0 6px 20px rgba(18,51,44,.10);padding:18px 18px 12px;display:flex;flex-direction:column;align-items:center}
  svg{height:${artH}px;width:auto;max-width:${one ? 900 : square ? (figs.length > 2 ? 420 : 440) : 250}px;display:block}
  figcaption{font-size:${square ? 30 : 24}px;font-weight:700;color:#2F7D6B;padding-top:8px;white-space:pre}
  </style></head><body><div class="tag">General guide</div><h1>${esc(title)}</h1><div class="row">${cards}</div></body></html>`;
}

const PW = process.env.PLAYWRIGHT_CORE ?? '/Users/neketpatil/project/aarogyam/node_modules/.pnpm/playwright-core@1.63.0/node_modules/playwright-core';
const { chromium } = createRequire(import.meta.url)(PW);
const browser = await chromium.launch();
const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7);
fs.mkdirSync(OUT, { recursive: true });

for (const [id, t] of Object.entries(topics.topics)) {
  if (only && id !== only) continue;
  const page = pages[t.topic];
  if (!page) throw new Error(`no learn page for ${t.topic}`);
  const figs = await figures(page, id);
  for (const [kind, square] of [['still', false], ['square', true]]) {
    const [w, h] = square ? [1080, 1080] : [1200, 630];
    const tab = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    await tab.setContent(html(t.title, figs, square));
    let quality = 84;
    let buf = await tab.screenshot({ type: 'jpeg', quality });
    while (buf.length > LIMITS[kind] && quality > 50) {
      quality -= 6;
      buf = await tab.screenshot({ type: 'jpeg', quality });
    }
    if (buf.length > LIMITS[kind]) throw new Error(`${id} ${kind}: ${buf.length} bytes is over the budget`);
    await tab.close();
    const file = path.join(OUT, square ? `${id}-square.jpg` : `${id}.jpg`);
    fs.writeFileSync(file, buf);
    t[kind] = { bytes: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex') };
    console.log(`${id} ${t.topic.padEnd(18)} ${kind.padEnd(6)} ${(buf.length / 1024).toFixed(1)} KB q${quality}`);
  }
}

await browser.close();
await server.close();
fs.writeFileSync(TOPICS, JSON.stringify(topics, null, 2) + '\n');
