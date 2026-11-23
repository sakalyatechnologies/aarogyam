#!/usr/bin/env node
// The story bundle's version file (design N7), so the phone builds check the bundle without Node.
//
//   manifest  print the built bundle's hash and sizes (after `vite build`)
//   sync      copy dist/ into mobile/story-bundle/story/ and write story-version.json, both the
//             committed web copy and mobile/story-bundle/story-version.json
//   check     fail when dist/ differs from the committed story-version.json (run `pnpm --filter
//             @aarogyam/story-bundle sync`, then commit both copies)
//
// content_hash: sha256 over the lines "<sha256 hex of the file>  <path>\n" for every file under
// story/, paths relative and sorted bytewise. The same as, in mobile/story-bundle/story:
//   find . -type f | sed 's|^\./||' | LC_ALL=C sort | xargs shasum -a 256 | shasum -a 256
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const app = join(dirname(fileURLToPath(import.meta.url)), "..");
const repo = join(app, "..", "..", "..");
const dist = join(app, "dist");
const mobile = join(repo, "mobile", "story-bundle");
const webVersion = join(app, "story-version.json");
const mobileVersion = join(mobile, "story-version.json");

function files(dir) {
  const out = [];
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else out.push(relative(dir, p).split(sep).join("/"));
    }
  };
  walk(dir);
  return out.sort((a, b) => (Buffer.from(a) < Buffer.from(b) ? -1 : Buffer.from(a) > Buffer.from(b) ? 1 : 0));
}

const sha = (buf) => createHash("sha256").update(buf).digest("hex");

function constant(file, pattern, what) {
  const m = readFileSync(join(repo, file), "utf8").match(pattern);
  if (m === null) throw new Error(`${what} not found in ${file}`);
  return m[1];
}

function versionOf(dir) {
  const list = files(dir);
  const lines = list.map((f) => `${sha(readFileSync(join(dir, f)))}  ${f}\n`).join("");
  return {
    $comment: "Written by web/apps/story-bundle/scripts/story-version.mjs; see its header for content_hash.",
    bundle_version: Number(constant("web/apps/story-bundle/src/channel.ts", /BUNDLE_VERSION = (\d+);/, "BUNDLE_VERSION")),
    story_versions: JSON.parse(constant("web/packages/app-kit/src/story-2d/index.ts", /STORY_VERSIONS: readonly number\[\] = (\[[\d, ]*\]);/, "STORY_VERSIONS")),
    content_hash: sha(lines),
    files: list.length,
    bytes: list.reduce((n, f) => n + statSync(join(dir, f)).size, 0),
  };
}

const text = (v) => `${JSON.stringify(v, null, 2)}\n`;

function sizes(dir) {
  const rows = files(dir)
    .filter((f) => /\.(js|css|html)$/.test(f))
    .map((f) => {
      const buf = readFileSync(join(dir, f));
      return { f, raw: buf.length, gz: gzipSync(buf, { level: 9 }).length };
    });
  const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
  const entryJs = readFileSync(join(dir, "index.html"), "utf8").match(/src="\.\/(assets\/[^"]+\.js)"/)?.[1];
  const entry = rows.find((r) => r.f === entryJs);
  const total = rows.reduce((a, r) => ({ raw: a.raw + r.raw, gz: a.gz + r.gz }), { raw: 0, gz: 0 });
  return `entry ${entryJs ?? "?"}: ${entry === undefined ? "?" : `${kb(entry.raw)} (${kb(entry.gz)} gz)`}; all JS/CSS/HTML: ${kb(total.raw)} (${kb(total.gz)} gz) in ${String(rows.length)} files`;
}

const mode = process.argv[2];
if (!existsSync(join(dist, "index.html"))) throw new Error("dist/ is missing: run vite build first");
const built = versionOf(dist);
if (mode === "manifest") {
  process.stdout.write(`story bundle v${String(built.bundle_version)} ${built.content_hash}\n${sizes(dist)}\n`);
} else if (mode === "sync") {
  const story = join(mobile, "story");
  rmSync(story, { recursive: true, force: true });
  mkdirSync(story, { recursive: true });
  cpSync(dist, story, { recursive: true });
  const synced = versionOf(story);
  if (synced.content_hash !== built.content_hash) throw new Error("the copy differs from dist/");
  writeFileSync(webVersion, text(synced));
  writeFileSync(mobileVersion, text(synced));
  process.stdout.write(`synced to mobile/story-bundle/story/: v${String(synced.bundle_version)} ${synced.content_hash}\n${sizes(story)}\n`);
} else if (mode === "check") {
  const committed = existsSync(webVersion) ? readFileSync(webVersion, "utf8") : "";
  if (committed !== text(built)) {
    process.stderr.write("The story bundle changed: run `pnpm --filter @aarogyam/story-bundle sync` and commit web/apps/story-bundle/story-version.json and mobile/story-bundle/.\n");
    process.exit(1);
  }
  process.stdout.write(`story bundle up to date: ${built.content_hash}\n`);
} else {
  process.stderr.write("usage: story-version.mjs manifest|sync|check\n");
  process.exit(2);
}
