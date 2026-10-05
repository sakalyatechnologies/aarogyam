import type { ComponentType } from "react";
import type { LazyRouteFunction, RouteObject } from "react-router";

const RELOADED = "aarogyam.reloaded-for-new-version";

/**
 * After a deploy the old version's page files are gone, so a tab opened before it can't load a
 * page it hasn't visited yet. Reloading once fetches the new version; a second failure in the
 * same tab is a real error and is shown. Returns whether the page is reloading.
 */
export function reloadOnceForNewVersion(): boolean {
  try {
    if (sessionStorage.getItem(RELOADED) !== null) {
      return false;
    }
    sessionStorage.setItem(RELOADED, "1");
  } catch {
    return false;
  }
  window.location.reload();
  return true;
}

function forgetReload() {
  try {
    sessionStorage.removeItem(RELOADED);
  } catch {
    // Storage blocked: nothing was remembered either.
  }
}

/**
 * A route's `lazy` that loads its page's code the first time the route is visited, so the first
 * load carries only the shell and the page asked for.
 *
 * ```tsx
 * { path: "today", lazy: lazyPage(() => import("./pages/today-page.js"), (m) => m.TodayPage) }
 * ```
 */
export function lazyPage<M>(
  load: () => Promise<M>,
  pick: (module: M) => ComponentType,
  recover: () => boolean = reloadOnceForNewVersion,
): LazyRouteFunction<RouteObject> {
  return async () => {
    let loaded: M;
    try {
      loaded = await load();
    } catch (error) {
      if (recover()) {
        // The page is reloading; never settle, so nothing renders in between.
        return new Promise<never>(() => undefined);
      }
      throw error;
    }
    forgetReload();
    return { Component: pick(loaded) };
  };
}
