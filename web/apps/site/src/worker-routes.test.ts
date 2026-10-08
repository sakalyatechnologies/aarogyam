import { describe, expect, it } from "vitest";

import { isPublicSiteRoute } from "../../../../deploy/cloudflare/site/routes.js";

describe("the site Worker's API allowlist", () => {
  const photo = "/api/v1/public/site/photos/0190f3a2-7b1c-7a3e-9d41-2f6c8e5b7a10";

  it("passes reads of the published site and its pictures", () => {
    expect(isPublicSiteRoute("GET", "/api/v1/public/site")).toBe(true);
    expect(isPublicSiteRoute("HEAD", photo)).toBe(true);
  });

  it("refuses everything else under /api, so no signed-in or patient route is reachable", () => {
    for (const path of [
      "/api/v1/me",
      "/api/v1/patients",
      "/api/v1/settings/website",
      "/api/v1/public/site/",
      "/api/v1/public/site/photos/../../me",
      "/api/v1/public/bookings",
      "/api/v1/auth/handoff",
      "/api",
    ]) {
      expect(isPublicSiteRoute("GET", path), path).toBe(false);
    }
    expect(isPublicSiteRoute("POST", "/api/v1/public/site")).toBe(false);
    expect(isPublicSiteRoute("DELETE", photo)).toBe(false);
  });
});
