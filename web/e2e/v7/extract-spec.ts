// Reads exact design values out of the v7 mobile mockup (docs/mockups/mobile-v7.html):
// theme tokens for every palette and mode, and computed styles of key elements per platform.
// Output: docs/mockups/mobile-v7-spec.json. Run: node web/e2e/v7/extract-spec.ts
import { chromium, type Page } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

type Styles = Record<string, string | { w: number; h: number }>;
type Spec = {
  source: string;
  extractedAt: string;
  palettes: Record<string, Record<string, string>>;
  elements: Record<string, Record<string, Record<string, Styles | null>>>;
  canvas?: { w: number; h: number };
};

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const mockup = `file://${root}/docs/mockups/mobile-v7.html`;
const TOKENS = ["--p", "--p2", "--on-p", "--pc", "--on-pc", "--t", "--tc", "--on-tc", "--bg", "--s1", "--s2", "--s3", "--card", "--sheet", "--on", "--on-v", "--ol", "--err", "--errc", "--on-errc"];

// Selectors measured inside each phone after sign-in, on the screen where they appear.
const ELEMENTS = {
  today: [".nav .big", ".nav .kick", ".mecard", ".mecard h3", ".mecard .role", ".mecard .av", ".mecard .chipsx span", ".stats .s", ".stats b", ".stats span", ".hero", ".hero .n", ".hero .s", ".hero .k", ".hero .acts .btn", ".sec-h", ".car .c", ".car .c.first", ".car b", ".li", ".li b", ".li small", ".pill", ".tabbar", ".tabs", ".tabs .tb", ".tabbar .solo", ".iconbtn", ".money .card", ".dark", ".dark .ap"],
  sched: [".segc", ".segc button", ".chairc", ".ticket", ".ticket .tn", ".ticket .wt"],
  more: [".profrow", ".profrow .av", ".tile", ".tile .ti", ".mlist .li"],
};
const PROPS = ["fontFamily", "fontSize", "fontWeight", "lineHeight", "letterSpacing", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "borderTopLeftRadius", "borderTopRightRadius", "borderBottomLeftRadius", "borderBottomRightRadius", "width", "height", "gap", "backgroundColor", "color", "boxShadow"];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
await page.goto(mockup, { waitUntil: "networkidle" });

const out: Spec = { source: "docs/mockups/mobile-v7.html", extractedAt: new Date().toISOString(), palettes: {}, elements: {} };
const swatches = page.locator("#swatches button");
const names = await swatches.evaluateAll((bs) => bs.map((b) => b.getAttribute("title") ?? ""));
for (const mode of ["light", "dark"]) {
  await page.locator(`[data-mode=${mode}]`).click();
  for (let i = 0; i < names.length; i++) {
    await swatches.nth(i).click();
    out.palettes[`${names[i]}.${mode}`] = await page.locator("#ph-and").evaluate((el, ks: string[]) => {
      const cs = getComputedStyle(el);
      return Object.fromEntries(ks.map((k) => [k, cs.getPropertyValue(k).trim()]));
    }, TOKENS);
  }
}

// Measure in light mode with the first palette, signed in on both phones.
await page.locator("[data-mode=light]").click();
await swatches.nth(0).click();
for (const plat of ["ios", "and"]) {
  const ph = page.locator(`#ph-${plat}`);
  await ph.locator("[data-act=getstarted]").click();
  await page.waitForTimeout(600);
  await ph.locator("[data-act=sendotp]").click();
}
await page.waitForTimeout(5500);

const measure = (p: Page, plat: string, sels: string[]): Promise<Record<string, Styles | null>> =>
  p.locator(`#ph-${plat}`).evaluate((rootEl, args: { sels: string[]; props: string[] }) => {
    const res: Record<string, Record<string, string | { w: number; h: number }> | null> = {};
    for (const s of args.sels) {
      const el = rootEl.querySelector(`.screen:last-of-type ${s}`) ?? rootEl.querySelector(s);
      if (!el) {
        res[s] = null;
        continue;
      }
      const cs = getComputedStyle(el);
      const kebab = (prop: string): string => prop.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
      const r = el.getBoundingClientRect();
      const styles: Record<string, string | { w: number; h: number }> = Object.fromEntries(args.props.map((prop) => [prop, cs.getPropertyValue(kebab(prop))]));
      styles.box = { w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10 };
      res[s] = styles;
    }
    return res;
  }, { sels, props: PROPS });

for (const plat of ["ios", "and"]) {
  const screens: Record<string, Record<string, Styles | null>> = {};
  screens.today = await measure(page, plat, ELEMENTS.today);
  await page.locator(`#ph-${plat} .tabbar [data-act=tab][data-t=sched]`).click();
  await page.waitForTimeout(900);
  screens.sched = await measure(page, plat, ELEMENTS.sched);
  await page.locator(`#ph-${plat} .tabbar [data-act=tab][data-t=more]`).click();
  await page.waitForTimeout(900);
  screens.more = await measure(page, plat, ELEMENTS.more);
  out.elements[plat] = screens;
}
// Phone canvas size the mockup draws at (all px values are relative to this width).
out.canvas = await page.locator("#ph-and").evaluate((el) => ({ w: el.clientWidth, h: el.clientHeight }));
writeFileSync(`${root}/docs/mockups/mobile-v7-spec.json`, JSON.stringify(out, null, 1));
process.stdout.write(`palettes ${String(Object.keys(out.palettes).length)}, canvas ${JSON.stringify(out.canvas)}\n`);
await browser.close();
