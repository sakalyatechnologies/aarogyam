// The public learn site (docs/plans/visit-story-v2-offers-design.md, sections 1.8 and 1.9): one
// static page per topic at /learn/<id>, with the generic still as its og:image. Pure: data in,
// files out. No script, no analytics, no patient and no clinic; the id is opaque (rule 6).

export interface Still {
  bytes: number;
  sha256: string;
}

export interface TopicEntry {
  topic: string;
  title: string;
  still: Still;
  square: Still;
}

export interface TopicsFile {
  topics: Record<string, TopicEntry>;
}

export interface PageStep {
  scene: string;
  label: string;
  text: string;
}

export interface PageCopy {
  summary: string;
  steps: PageStep[];
  expect: string[];
  call: string[];
}

export interface PagesFile {
  general_note: string;
  call_heading: string;
  pages: Record<string, PageCopy>;
}

/** Where a published file comes from: text, or a still read from web/apps/learn/stills. */
export type SiteFile = { text: string } | { still: string };

/** Learn HTML: short cache (copy fixes reach phones soon), never indexed, no referrer. */
export const PAGE_CACHE = "public, max-age=300";
/** Stills have content-hashed names, so they never change. */
export const STILL_CACHE = "public, max-age=31536000, immutable";
/** Nothing but the page's own inline style and same-origin images can load. */
export const CSP = "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);

/** The published name of a still: the id plus a content hash, so it can be cached for good. */
export function stillName(id: string, kind: "still" | "square", still: Still): string {
  return `img/${id}${kind === "square" ? "-square" : ""}.${still.sha256.slice(0, 10)}.jpg`;
}

/** The page's address on the learn host; the Rust composer builds the same one. */
export function pageUrl(origin: string, id: string): string {
  return `${origin}/learn/${id}`;
}

function page(origin: string, id: string, entry: TopicEntry, copy: PageCopy, shared: PagesFile): string {
  const image = `${origin}/${stillName(id, "still", entry.still)}`;
  const title = esc(entry.title);
  const summary = esc(copy.summary);
  const steps = copy.steps.map((s) => `<li><strong>${esc(s.label)}.</strong> ${esc(s.text)}</li>`).join("");
  const list = (items: string[]) => items.map((t) => `<li>${esc(t)}</li>`).join("");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="referrer" content="no-referrer">
<title>${title}</title>
<meta name="description" content="${summary}">
<meta property="og:type" content="article">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${summary}">
<meta property="og:url" content="${pageUrl(origin, id)}">
<meta property="og:image" content="${image}">
<meta property="og:image:type" content="image/jpeg">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${title}: a general illustration">
<meta name="twitter:card" content="summary_large_image">
<style>
:root{--bg:#F4FAF7;--card:#fff;--ink:#12332C;--muted:#4A6660;--accent:#2F7D6B;--line:#D6E7E0;color-scheme:light dark}
@media (prefers-color-scheme:dark){:root{--bg:#0F1D1A;--card:#16302A;--ink:#E6F2EE;--muted:#A8C2BB;--accent:#7FCDB8;--line:#244A41}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:17px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:680px;margin:0 auto;padding:24px 16px 48px}
.tag{margin:0;font-size:13px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--accent)}
h1{margin:6px 0 12px;font-size:30px;line-height:1.15}
h2{margin:28px 0 8px;font-size:20px}
img{display:block;width:100%;height:auto;border-radius:16px;border:1px solid var(--line)}
.note{margin:16px 0 0;padding:12px 14px;border-radius:12px;background:var(--card);border:1px solid var(--line);color:var(--muted);font-size:15px}
ol,ul{padding-left:22px;margin:0}li{margin:6px 0}
</style>
</head>
<body>
<main>
<p class="tag">General guide</p>
<h1>${title}</h1>
<img src="/${stillName(id, "still", entry.still)}" width="1200" height="630" alt="${title}: a general illustration">
<p>${summary}</p>
<h2>What usually happens</h2>
<ol>${steps}</ol>
<h2>What to expect</h2>
<ul>${list(copy.expect)}</ul>
<h2>${esc(shared.call_heading)}</h2>
<ul>${list(copy.call)}</ul>
<p class="note">${esc(shared.general_note)}</p>
</main>
</body>
</html>
`;
}

function notFound(): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><title>Page not found</title>
<style>body{margin:0;font:17px/1.5 system-ui,sans-serif;padding:32px 16px;background:#F4FAF7;color:#12332C}@media (prefers-color-scheme:dark){body{background:#0F1D1A;color:#E6F2EE}}</style>
</head><body><p>This page does not exist.</p></body></html>
`;
}

/** Workers static-assets headers: learn HTML, stills, then every response. */
export function headersFile(): string {
  return `/learn/*
  Cache-Control: ${PAGE_CACHE}
/img/*
  Cache-Control: ${STILL_CACHE}
/*
  X-Robots-Tag: noindex
  Referrer-Policy: no-referrer
  X-Content-Type-Options: nosniff
  Content-Security-Policy: ${CSP}
`;
}

/**
 * Every published file by its path in the assets directory. `origin` is the learn host's origin
 * (no trailing slash), needed because og:image must be absolute.
 */
export function buildSite(origin: string, topics: TopicsFile, pages: PagesFile): Map<string, SiteFile> {
  if (!/^https?:\/\/[a-z0-9.-]+(:\d+)?$/.test(origin)) throw new Error(`bad learn origin: ${origin}`);
  const files = new Map<string, SiteFile>();
  for (const [id, entry] of Object.entries(topics.topics)) {
    const copy = pages.pages[entry.topic];
    if (!copy) throw new Error(`no learn page for ${entry.topic}`);
    if (!entry.still.sha256 || !entry.square.sha256) throw new Error(`${id}: render the stills first`);
    // auto-trailing-slash serves learn/<id>.html at /learn/<id>.
    files.set(`learn/${id}.html`, { text: page(origin, id, entry, copy, pages) });
    files.set(stillName(id, "still", entry.still), { still: `${id}.jpg` });
    files.set(stillName(id, "square", entry.square), { still: `${id}-square.jpg` });
  }
  files.set("404.html", { text: notFound() });
  files.set("_headers", { text: headersFile() });
  return files;
}
