import { describe, expect, it } from "vitest";

import pagesJson from "../../../../specialties/dental/learn-pages.json";
import topicsJson from "../../../../specialties/dental/learn-topics.json";
import learnWrangler from "../../../../deploy/cloudflare/learn/wrangler.toml?raw";
import portalWorker from "../../../../deploy/cloudflare/portal/worker.ts?raw";
import apiProxy from "../../../../deploy/cloudflare/shared/api-proxy.ts?raw";
import { CSP, PAGE_CACHE, STILL_CACHE, buildSite, headersFile, pageUrl, stillName, type PagesFile, type TopicsFile } from "./site.js";

const topics: TopicsFile = topicsJson;
const pages: PagesFile = pagesJson;
const ORIGIN = "https://learn.aarogyam.example";
const site = buildSite(ORIGIN, topics, pages);
const text = (path: string): string => {
  const file = site.get(path);
  if (file === undefined || !("text" in file)) throw new Error(`no text file ${path}`);
  return file.text;
};
const TOPICS = ["root_canal", "filling", "extraction", "wisdom_extraction", "crown", "scaling", "implant", "sealant", "general_care"];

describe("the learn topics", () => {
  it("cover every treatment model and everyday care, once each", () => {
    expect(Object.values(topics.topics).map((t) => t.topic).sort()).toEqual([...TOPICS].sort());
  });

  it("have random ids that spell no procedure (rule 6)", () => {
    const words = ["root", "canal", "rct", "fill", "extract", "wisdom", "crown", "scal", "clean", "implant", "seal", "care", "tooth", "teeth"];
    for (const id of Object.keys(topics.topics)) {
      expect(id, id).toMatch(/^[bcdfghjkmnpqrstvwxz2-9]{6}$/);
      for (const word of words) expect(id.includes(word), `${id} ${word}`).toBe(false);
    }
  });

  it("have stills within the spec's budgets", () => {
    for (const [id, t] of Object.entries(topics.topics)) {
      expect(t.still.bytes, id).toBeGreaterThan(0);
      expect(t.still.bytes, id).toBeLessThanOrEqual(150 * 1024);
      expect(t.square.bytes, id).toBeLessThanOrEqual(200 * 1024);
      expect(t.still.sha256, id).toMatch(/^[0-9a-f]{64}$/);
    }
  });
});

describe("the learn pages", () => {
  it("serve one page per topic at /learn/<id> with absolute og tags", () => {
    for (const [id, t] of Object.entries(topics.topics)) {
      const html = text(`learn/${id}.html`);
      expect(html).toContain(`<meta property="og:title" content="${t.title}">`);
      expect(html).toContain(`<meta property="og:image" content="${ORIGIN}/${stillName(id, "still", t.still)}">`);
      expect(html).toContain(`<meta property="og:url" content="${pageUrl(ORIGIN, id)}">`);
      expect(html).toContain('<meta name="robots" content="noindex, nofollow">');
      expect(html).toContain("General guide");
      expect(html).toContain(pages.general_note.replace(/'/g, "&#39;"));
      expect(site.has(stillName(id, "still", t.still))).toBe(true);
      expect(site.has(stillName(id, "square", t.square))).toBe(true);
    }
  });

  it("carry no script, no analytics and no third-party address", () => {
    for (const [path, file] of site) {
      if (!("text" in file)) continue;
      expect(file.text, path).not.toMatch(/<script|<iframe|<link|gtag|analytics|beacon/i);
      for (const url of file.text.match(/https?:\/\/[^"'\s<]+/g) ?? []) expect(url.startsWith(ORIGIN), `${path} ${url}`).toBe(true);
    }
  });

  it("send the spec's headers: short cache for pages, immutable stills, noindex, no referrer", () => {
    const headers = headersFile();
    expect(text("_headers")).toBe(headers);
    expect(headers).toMatch(new RegExp(`^/learn/\\*\\n  Cache-Control: ${PAGE_CACHE}$`, "m"));
    expect(headers).toMatch(new RegExp(`^/img/\\*\\n  Cache-Control: ${STILL_CACHE}$`, "m"));
    for (const line of ["X-Robots-Tag: noindex", "Referrer-Policy: no-referrer", `Content-Security-Policy: ${CSP}`]) expect(headers).toContain(line);
    expect(CSP).toContain("default-src 'none'");
  });

  it("refuse an origin that is not a bare http(s) origin", () => {
    expect(() => buildSite("https://learn.aarogyam.example/", topics, pages)).toThrow();
    expect(() => buildSite("javascript:alert(1)", topics, pages)).toThrow();
  });
});

describe("what the Workers' logs can see (§1.9 reviewer table)", () => {
  it("the learn Worker is assets-only: no main, so no code of ours runs or logs", () => {
    expect(learnWrangler).not.toMatch(/^\s*main\s*=/m);
    expect(learnWrangler).not.toMatch(/run_worker_first|observability|logpush/);
    expect(learnWrangler).toMatch(/^directory = "..\/..\/..\/web\/apps\/learn\/dist"$/m);
  });

  it("the portal Worker that runs first on /shared/* logs nothing", () => {
    for (const source of [portalWorker, apiProxy]) expect(source).not.toMatch(/console\.|\blog\(/);
  });
});
