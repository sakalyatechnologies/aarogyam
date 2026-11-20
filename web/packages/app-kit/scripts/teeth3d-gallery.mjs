#!/usr/bin/env node
// Builds the dev-only 3D tooth gallery (src/real-teeth-3d/gallery) with Vite, reports the gzipped size
// of the lazy real-teeth-3d chunk (three.js included) against the 180 KB story budget, and
// screenshots the gallery at 390 px and desktop in light and dark.
// Usage: node web/packages/app-kit/scripts/teeth3d-gallery.mjs <outDir> [--no-shots] [--only=phone-light] [--section=N]
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORTAL = path.resolve(HERE, '../../../apps/portal');
const require = createRequire(path.join(PORTAL, 'package.json'));
const { build } = await import(require.resolve('vite'));
const out = path.resolve(process.argv[2] ?? 'teeth3d-gallery');
const root = path.resolve(HERE, '../src/real-teeth-3d/gallery');
const BUDGET = 180 * 1024;

await build({
  root, base: './', logLevel: 'warn',
  build: { outDir: path.join(out, 'site'), emptyOutDir: true, manifest: true, minify: true, chunkSizeWarningLimit: 4000 },
});

// the lazy chunk: the dynamic import of real-teeth-3d and everything it pulls in
const man = JSON.parse(fs.readFileSync(path.join(out, 'site/.vite/manifest.json'), 'utf8'));
const gz = (f) => zlib.gzipSync(fs.readFileSync(path.join(out, 'site', f)), { level: 9 }).length;
const rows = [];
for (const [src, e] of Object.entries(man)) {
  if (!e.isDynamicEntry) continue;
  const files = new Set([e.file]);
  const walk = (k) => { for (const i of man[k]?.imports ?? []) if (!files.has(man[i].file)) { files.add(man[i].file); walk(i); } };
  walk(src);
  const total = [...files].reduce((s, f) => s + gz(f), 0);
  rows.push(`${src.replace(/.*src\//, '')}: ${[...files].join(' + ')} = ${(total / 1024).toFixed(1)} KB gz (budget 180 KB) ${total <= BUDGET ? 'OK' : 'OVER'}`);
  if (total > BUDGET) process.exitCode = 1;
}
fs.writeFileSync(path.join(out, 'sizes.txt'), rows.join('\n') + '\n');
console.log(rows.join('\n'));
if (process.argv.includes('--no-shots')) process.exit(process.exitCode ?? 0);

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  const p = path.join(out, 'site', decodeURIComponent((req.url ?? '/').split('?')[0]).replace(/\/$/, '/index.html'));
  if (!fs.existsSync(p)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': types[path.extname(p)] ?? 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
}).listen(0);
const port = server.address().port;
const PW = process.env.PLAYWRIGHT_CORE ?? '/Users/neketpatil/project/aarogyam/node_modules/.pnpm/playwright-core@1.63.0/node_modules/playwright-core';
const { chromium } = createRequire(import.meta.url)(PW);
const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7);
const section = process.argv.find((a) => a.startsWith('--section='))?.slice(10);
for (const [n, w, h, cs, mob] of [['phone-light', 390, 844, 'light', true], ['phone-dark', 390, 844, 'dark', true], ['desktop-light', 1280, 900, 'light', false], ['desktop-dark', 1280, 900, 'dark', false]]) {
  if (only && !n.startsWith(only)) continue;
  const b = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: w, height: h }, colorScheme: cs, deviceScaleFactor: mob ? 2 : 1, isMobile: mob });
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  p.on('request', (r) => { if (!r.url().startsWith(`http://127.0.0.1:${port}/`) && !r.url().startsWith('data:')) errs.push(`network: ${r.url()}`); });
  await p.goto(`http://127.0.0.1:${port}/${section ? `?only=${section}` : ''}`);
  await p.waitForSelector('body[data-done="1"]', { timeout: 600000 });
  console.log(n, await p.textContent('#stats'));
  // the whole page can exceed the capture limit on a phone (one long column); sections always fit
  await p.screenshot({ path: path.join(out, `shot-${n}.png`), fullPage: true }).catch(() => console.log(n, 'full page too tall, sections only'));
  const secs = await p.evaluate(() => {
    const hs = [...document.querySelectorAll('h2')];
    return hs.map((x, i) => ({ y: x.getBoundingClientRect().top + scrollY, y1: i + 1 < hs.length ? hs[i + 1].getBoundingClientRect().top + scrollY : document.body.scrollHeight }));
  });
  for (const [i, s] of secs.entries()) {
    for (let k = 0, y = s.y; y < s.y1; k++, y += 2400) {
      await p.screenshot({ path: path.join(out, `sec-${n}-${section ?? i}-${k}.png`), fullPage: true, clip: { x: 0, y, width: w, height: Math.min(2400, s.y1 - y) } });
    }
  }
  if (errs.length) console.log(n, errs.slice(0, 5));
  await p.close();
  await b.close();
}
server.close();
console.log('shots in', out);
