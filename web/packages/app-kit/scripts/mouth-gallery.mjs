#!/usr/bin/env node
// Builds the dev-only mouth art gallery (src/mouth-art/gallery) with Vite, reports gzipped chunk
// sizes from the manifest, and screenshots it at 390 px and desktop in light and dark.
// Usage: node web/packages/app-kit/scripts/mouth-gallery.mjs <outDir> [--no-shots]
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
const react = (await import(require.resolve('@vitejs/plugin-react'))).default;
const out = path.resolve(process.argv[2] ?? 'mouth-gallery');
const root = path.resolve(HERE, '../src/mouth-art/gallery');

await build({
  root, base: './', logLevel: 'warn', plugins: [react()],
  resolve: { dedupe: ['react', 'react-dom'] },
  build: { outDir: path.join(out, 'site'), emptyOutDir: true, manifest: true, minify: true, chunkSizeWarningLimit: 4000 },
});

// chunk sizes
const man = JSON.parse(fs.readFileSync(path.join(out, 'site/.vite/manifest.json'), 'utf8'));
const rows = [];
for (const [src, e] of Object.entries(man)) {
  if (!/gen\/(teeth|stages|brushing)\/|gen\/(shapes|textures)|mouth-art\/(brushing|react|scene|render|overlays)/.test(src)) continue;
  const buf = fs.readFileSync(path.join(out, 'site', e.file));
  rows.push([src.replace(/.*mouth-art\//, ''), buf.length, zlib.gzipSync(buf, { level: 9 }).length]);
}
rows.sort((a, b) => a[0].localeCompare(b[0]));
const report = rows.map(([s, raw, gz]) => `${s.padEnd(34)} ${String(raw).padStart(7)} B  ${(gz / 1024).toFixed(2).padStart(6)} KB gz`).join('\n');
fs.writeFileSync(path.join(out, 'sizes.txt'), report + '\n');
console.log(report);
if (process.argv.includes('--no-shots')) process.exit(0);

// serve + screenshot
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
const b = await chromium.launch();
const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7);
for (const [n, w, h, cs, mob] of [['phone-light', 390, 844, 'light', true], ['phone-dark', 390, 844, 'dark', true], ['desktop-light', 1280, 900, 'light', false], ['desktop-dark', 1280, 900, 'dark', false]]) {
  if (only && !n.startsWith(only)) continue;
  const p = await b.newPage({ viewport: { width: w, height: h }, colorScheme: cs, deviceScaleFactor: mob ? 2 : 1, isMobile: mob });
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  await p.goto(`http://127.0.0.1:${port}/`);
  await p.waitForSelector('main', { timeout: 20000 });
  await p.waitForTimeout(700);
  await p.screenshot({ path: path.join(out, `shot-${n}.png`), fullPage: true });
  // one screenshot per gallery section, for review
  const secs = await p.evaluate(() => {
    const hs = [...document.querySelectorAll('h2')];
    return hs.map((h, i) => ({ y: h.getBoundingClientRect().top + scrollY, y1: i + 1 < hs.length ? hs[i + 1].getBoundingClientRect().top + scrollY : document.body.scrollHeight }));
  });
  for (const [i, s] of secs.entries()) {
    for (let k = 0, y = s.y; y < s.y1; k++, y += 2400) {
      await p.screenshot({ path: path.join(out, `sec-${n}-${i}-${k}.png`), fullPage: true, clip: { x: 0, y, width: w, height: Math.min(2400, s.y1 - y) } });
    }
  }
  if (errs.length) console.log(n, errs.slice(0, 5));
  await p.close();
}
await b.close();
server.close();
console.log('shots in', out);
