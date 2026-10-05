import { describe, expect, it, vi } from "vitest";

import { lazyPage } from "./lazy-page.js";

function Page() {
  return null;
}

describe("lazyPage", () => {
  it("gives the router the page's component once its code loads", async () => {
    const load = vi.fn(() => Promise.resolve({ Page }));
    const lazy = lazyPage(load, (m) => m.Page);
    expect(load).not.toHaveBeenCalled();
    await expect(lazy()).resolves.toEqual({ Component: Page });
  });

  it("recovers from a missing file once, then reports the error", async () => {
    const gone = new Error("Failed to fetch dynamically imported module");
    const load = () => Promise.reject(gone);
    let reloading = vi.fn(() => true);
    const pending = lazyPage(load, (m: { Page: typeof Page }) => m.Page, reloading)();
    const settled = await Promise.race([pending.then(() => "settled"), new Promise((r) => setTimeout(() => { r("waiting"); }, 20))]);
    expect(settled).toBe("waiting");
    expect(reloading).toHaveBeenCalledOnce();

    reloading = vi.fn(() => false);
    await expect(lazyPage(load, (m: { Page: typeof Page }) => m.Page, reloading)()).rejects.toBe(gone);
  });
});
