import { describe, expect, it } from "vitest";

import { KB, presentBudget, type Chunk } from "../../../../scripts/size-budget.mjs";

// A made-up manifest: the shell, the Present route with app-kit/present's shared chunk and MouthView, the painted style and art.
const manifest: Record<string, Chunk> = {
  "index.html": { file: "index.js", imports: ["_shell.js"], dynamicImports: ["src/pages/visits/present/present-page.tsx"] },
  "_shell.js": { file: "shell.js" },
  "src/pages/visits/present/present-page.tsx": { file: "present-page.js", src: "src/pages/visits/present/present-page.tsx", isDynamicEntry: true, imports: ["_blocks-x.js", "_mouth-view-x.js", "_shell.js"], dynamicImports: ["../../packages/app-kit/src/present/painted.tsx"] },
  "_blocks-x.js": { file: "blocks.js" },
  "_mouth-view-x.js": { file: "mouth-view.js" },
  "../../packages/app-kit/src/present/painted.tsx": { file: "painted.js", src: "../../packages/app-kit/src/present/painted.tsx", isDynamicEntry: true, imports: ["_blocks-x.js"] },
  "../../packages/app-kit/src/mouth-art/gen/teeth/u1.ts": { file: "u1.js", src: "../../packages/app-kit/src/mouth-art/gen/teeth/u1.ts", isDynamicEntry: true },
};
const sizes: Record<string, number> = { "index.js": 100, "shell.js": 100, "present-page.js": 5, "blocks.js": 4, "mouth-view.js": 30, "painted.js": 14, "u1.js": 9 };
const gzOf = (over: Record<string, number> = {}) => (file: string) => ({ ...sizes, ...over }[file] ?? 0) * KB;
const art = /\/gen\/teeth\/u1\./;

describe("Present size budget (present-studio-design §13)", () => {
  it("measures the route's own code, everything it loads, the painted style and the prefetch", () => {
    const r = presentBudget({ manifest, entry: "index.html", gz: gzOf(), art });
    expect(r).toEqual({ failures: [], own: 9 * KB, route: 39 * KB, painted: 14 * KB, art: 9 * KB, prefetch: 62 * KB });
  });

  it("fails over a budget", () => {
    const r = presentBudget({ manifest, entry: "index.html", gz: gzOf({ "painted.js": 70, "blocks.js": 41 }), art });
    expect(r.failures).toEqual([
      "the Present route's own code is 46.0 KB gzipped, over 40 KB",
      "the Present route with what it loads is 76.0 KB gzipped, over 52 KB",
      "the painted style is 70.0 KB gzipped, over 65 KB",
    ]);
  });
});
