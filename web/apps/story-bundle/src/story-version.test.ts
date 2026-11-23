// The committed bundle in mobile/story-bundle/ matches its version file (design N7): the same check the
// phone builds make without Node. A stale bundle (source changed, not synced) is caught by
// `pnpm --filter @aarogyam/story-bundle check:sync`.
import { describe, expect, it } from "vitest";

import { STORY_VERSIONS } from "@aarogyam/app-kit/story-2d";

import mobileVersion from "../../../../mobile/story-bundle/story-version.json" with { type: "json" };
import webVersion from "../story-version.json" with { type: "json" };
import { BUNDLE_VERSION } from "./channel.js";

// Every file of the bundle is text (HTML, JS, CSS); a binary asset would need a byte read here.
const files = import.meta.glob<string>("../../../../mobile/story-bundle/story/**/*", { query: "?raw", import: "default", eager: true });
const PREFIX = "../../../../mobile/story-bundle/story/";

const hex = async (data: string): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(data));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
};

describe("story-version.json", () => {
  it("is the same in web/ and mobile/, with this page's bridge and story versions", () => {
    expect(mobileVersion).toEqual(webVersion);
    expect(webVersion.bundle_version).toBe(BUNDLE_VERSION);
    expect(webVersion.story_versions).toEqual(STORY_VERSIONS);
  });

  it("hashes the synced files in mobile/story-bundle/story/", async () => {
    const paths = Object.keys(files).map((p) => p.slice(PREFIX.length)).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    expect(paths).toContain("index.html");
    expect(paths).toHaveLength(webVersion.files);
    let lines = "";
    for (const p of paths) lines += `${await hex(files[PREFIX + p] ?? "")}  ${p}\n`;
    expect(await hex(lines)).toBe(webVersion.content_hash);
  });
});
