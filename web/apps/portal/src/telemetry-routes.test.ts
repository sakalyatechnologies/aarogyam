import { describe, expect, it } from "vitest";
import type { RouteObject } from "react-router";

import { routes } from "./routes.js";
import raw from "./telemetry-routes.json?raw";

/** Every page's template, as the router's matched patterns join (`routeTemplate` in app-kit). */
function templates(list: readonly RouteObject[], parent: readonly string[] = []): string[] {
  return list.flatMap((route) => {
    const path = [...parent, ...(route.path ?? "").split("/").filter((segment) => segment !== "")];
    const own = route.index === true || (route.path !== undefined && route.children === undefined) ? [`/${path.join("/")}`] : [];
    return [...own, ...templates(route.children ?? [], path)];
  });
}

const parsed: unknown = JSON.parse(raw);
const allowed = Array.isArray(parsed) ? parsed.map(String) : [];

describe("page counter routes", () => {
  // The API counts only these templates (crates/aarogyam-domain/src/telemetry.rs checks this file too).
  it("lists every page the router has, and nothing else", () => {
    expect([...new Set(templates(routes))].sort()).toEqual([...allowed].sort());
  });
});
