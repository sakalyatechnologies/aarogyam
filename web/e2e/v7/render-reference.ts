// Renders the v7 mockup (docs/mockups/mobile-v7.html) for every sheet ID in docs/mockups/mobile-v7-spec.md,
// per platform, width and theme, into mobile/docs/screenshots/v7/reference/<id>.<ios|and>.<width>.<light|dark>.png.
// Run: node web/e2e/v7/render-reference.ts [ID ...]   (no IDs = all)
import { chromium, type Locator, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const mockup = `file://${root}/docs/mockups/mobile-v7.html`;
const outDir = `${root}/mobile/docs/screenshots/v7/reference`;
mkdirSync(outDir, { recursive: true });
const WIDTHS = (process.env.V7_WIDTHS || "320,360,390,430").split(",").map(Number);
const THEMES = (process.env.V7_THEMES || "light,dark").split(",");
type Step = (p: Page, ph: Locator) => Promise<void>;
const wait = (p: Page, ms: number): Promise<void> => p.waitForTimeout(ms);

// Each step receives (page, phone locator) and leaves the phone showing that sheet ID.
const tap = (sel: string): Step => async (p, ph) => { await ph.locator(sel).first().click(); await wait(p, 900); };
const scroll = (y: number): Step => async (p, ph) => { await ph.locator(".screen .scroll").last().evaluate((e, y: number) => { e.scrollTop = y; e.dispatchEvent(new Event("scroll")); }, y); await wait(p, 700); };
const pager = (sel: string, i: number): Step => async (p, ph) => { await ph.locator(sel).first().evaluate((e, i: number) => { e.scrollLeft = e.clientWidth * i; }, i); await wait(p, 700); };
const signIn: Step = async (p, ph) => { await tap("[data-act=getstarted]")(p, ph); await tap("[data-act=sendotp]")(p, ph); await wait(p, 4800); };
const role = (r: string): Step => async (p) => { await p.locator(`[data-role=${r}]`).click(); await wait(p, 1500); };
const tab = (t: string): Step => tap(`.tabbar [data-act=tab][data-t=${t}]`);
const steps = (...fns: Step[]): Step => async (p, ph) => { for (const f of fns) await f(p, ph); };

const IDS: Record<string, Step> = {
  W1: steps(),
  W2: steps(pager(".pager", 1)),
  W3: steps(pager(".pager", 2)),
  AU1: steps(tap("[data-act=getstarted]")),
  AU2: steps(tap("[data-act=getstarted]"), tap("[data-act=sendotp]"), async (p) => wait(p, 1300)),
  AU4: steps(tap("[data-act=invite]")),
  AU5: steps(tap("[data-act=invite]"), tap("[data-act=joinlink]")),
  W4: steps(tap("[data-act=getstarted]"), tap("[data-act=sendotp]"), async (p) => wait(p, 2350)),
  T1: steps(signIn),
  T2: steps(signIn, pager(".mepager", 1)),
  T3: steps(signIn, scroll(330)),
  T4: steps(signIn, scroll(720)),
  T5: steps(role("finance"), signIn),
  P1: steps(signIn, tab("patients")),
  P2: steps(signIn, tab("patients"), tap(".plist .li")),
  P3: steps(signIn, tab("patients"), tap(".plist .li"), scroll(300)),
  P4: steps(signIn, tab("patients"), tap(".plist .li"), tap(".ptabs [data-k=visits]")),
  P5: steps(signIn, tab("patients"), tap(".plist .li"), tap(".ptabs [data-k=rx]")),
  P6: steps(signIn, tab("patients"), tap(".plist .li"), tap(".ptabs [data-k=bills]")),
  C1: steps(signIn, tab("patients"), tap(".plist .li"), tap(".tooth.rct")),
  S1: steps(signIn, tab("sched")),
  S2: steps(signIn, tab("sched"), tap("[data-act=sv][data-v=day]")),
  S3: steps(signIn, tab("sched"), tap("[data-act=sv][data-v=week]")),
  M1: steps(signIn, tab("more")),
  M2: steps(signIn, tab("more"), tap("[data-act=more][data-k=stats]"), async (p) => wait(p, 1200)),
  M3: steps(signIn, tab("more"), tap("[data-act=more][data-k=stats]"), async (p) => wait(p, 900), scroll(560)),
  M4: steps(signIn, tab("more"), tap("[data-act=more][data-k=stats]"), async (p) => wait(p, 900), scroll(1300)),
  M5: steps(signIn, tab("more"), tap("[data-act=more][data-k=stock]")),
  M6: steps(signIn, tab("more"), tap("[data-act=more][data-k=lab]")),
  M7: steps(signIn, tab("more"), tap("[data-act=more][data-k=team]")),
  M9: steps(signIn, tab("more"), tap("[data-act=more][data-k=help]")),
  M10: steps(signIn, tab("more"), tap("[data-act=more][data-k=swap]")),
  M11: steps(signIn, tab("more"), tap("[data-act=more][data-k=msgs]")),
  SH1: steps(signIn, tap(".tabbar .solo")),
  SH2: steps(signIn, tab("sched"), tap("[data-act=book]")),
  SH3: steps(signIn, tab("patients"), tap(".plist .li"), tap("[data-act=rx]")),
  SH4: steps(signIn, tab("patients"), tap(".plist .li"), tap("[data-act=rx]"), async (p, ph) => { const s = ph.locator(".sheet [data-act=swapabx]"); if (await s.count()) await s.click(); await ph.locator(".sheet [data-act=sendrx]").click(); await wait(p, 900); }),
  SH5: steps(signIn, tab("patients"), tap(".plist .li"), tap(".phead [data-act=share]")),
  SH6: steps(signIn, tab("more"), tap("[data-act=more][data-k=expense]")),
  SH7: steps(signIn, tap("[data-act=avatars]")),
  SH8: steps(signIn, tap("[data-act=qr]")),
  SH9: steps(signIn, tap("[data-act=notif]")),
  SH10: steps(signIn, tab("more"), tap("[data-act=more][data-k=lang]")),
};

const want = process.argv.slice(2);
const ids = Object.keys(IDS).filter((id) => !want.length || want.includes(id));
const browser = await chromium.launch();
let count = 0;
for (const plat of ["ios", "and"]) {
  for (const width of WIDTHS) {
    for (const theme of THEMES) {
      for (const id of ids) {
        const page = await browser.newPage({ viewport: { width: 900, height: 1100 } });
        page.setDefaultTimeout(8000);
        try {
          await page.goto(mockup, { waitUntil: "networkidle" });
          await page.addStyleTag({ content: `.frame{width:${String(width + 20)}px!important;max-width:none!important}` });
          await page.locator(`[data-show=${plat}]`).click();
          await page.locator(`[data-mode=${theme}]`).click();
          await wait(page, 300);
          const ph = page.locator(`#ph-${plat}`);
          await IDS[id](page, ph);
          await ph.screenshot({ path: `${outDir}/${id}.${plat}.${String(width)}.${theme}.png` });
          count++;
        } catch (e) {
          process.stdout.write(`FAILED ${id} ${plat} ${String(width)} ${theme}: ${(e instanceof Error ? e.message : String(e)).split("\n")[0] ?? ""}\n`);
        }
        await page.close();
      }
    }
  }
}
process.stdout.write(`rendered ${String(count)}\n`);
await browser.close();
