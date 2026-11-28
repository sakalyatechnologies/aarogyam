import { describe, expect, it } from "vitest";

import { appLinksResponse } from "../../../../deploy/cloudflare/portal/app-links.js";

const get = (path: string, method = "GET") => new Request(`https://sunrise.aarogyam.example${path}`, { method });

describe("the portal Worker's app links", () => {
  it("serves assetlinks.json as JSON with the configured fingerprints, no redirect", async () => {
    const response = appLinksResponse(get("/.well-known/assetlinks.json"), { ANDROID_CERT_SHA256: "AA:BB, CC:DD" });
    expect(response?.status).toBe(200);
    expect(response?.headers.get("content-type")).toBe("application/json");
    const body: unknown = await response?.json();
    expect(body).toMatchObject([
      { target: { package_name: "com.aarogyam.android", sha256_cert_fingerprints: ["AA:BB", "CC:DD"] } },
    ]);
  });

  it("serves the apple-app-site-association file as JSON for the invite, shared and arrive paths", async () => {
    const response = appLinksResponse(get("/.well-known/apple-app-site-association"), { APPLE_TEAM_ID: "TEAM123456" });
    expect(response?.headers.get("content-type")).toBe("application/json");
    const body: unknown = await response?.json();
    expect(body).toMatchObject({
      applinks: {
        details: [
          {
            appIDs: ["TEAM123456.com.aarogyam.ios"],
            components: [{ "/": "/invite*" }, { "/": "/shared/*" }, { "/": "/arrive*" }],
          },
        ],
      },
    });
  });

  it("leaves every other request alone", () => {
    expect(appLinksResponse(get("/invite"), {})).toBeUndefined();
    expect(appLinksResponse(get("/.well-known/assetlinks.json", "POST"), {})).toBeUndefined();
  });
});
