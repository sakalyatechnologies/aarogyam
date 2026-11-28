// App Links (Android) and Universal Links (iOS): the clinic's own https address opens the phone
// app when it is installed, and the portal page otherwise. Both files are answered by the Worker
// (not static assets) so they carry `application/json` and never redirect.
//
// Founder fills in (wrangler.toml [vars], or `wrangler deploy --var ...`):
//   ANDROID_CERT_SHA256  comma-separated SHA-256 fingerprints of the signing certificates
//                        (Play App Signing key plus the upload key), `AA:BB:...` form.
//   APPLE_TEAM_ID        the Apple developer team id (defaults to the team in the iOS project).

export interface AppLinksEnv {
  ANDROID_CERT_SHA256?: string;
  APPLE_TEAM_ID?: string;
}

export const ANDROID_PACKAGES = ["com.aarogyam.android"];
export const IOS_BUNDLE_IDS = ["com.aarogyam.ios"];
export const DEFAULT_APPLE_TEAM_ID = "WQCU2WYFHG";
export const APP_LINK_PATHS = ["/invite*", "/shared/*", "/arrive*"];

export function assetLinks(env: AppLinksEnv) {
  const fingerprints = (env.ANDROID_CERT_SHA256 ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value !== "");
  return ANDROID_PACKAGES.map((packageName) => ({
    relation: ["delegate_permission/common.handle_all_urls"],
    target: { namespace: "android_app", package_name: packageName, sha256_cert_fingerprints: fingerprints },
  }));
}

export function appleAppSiteAssociation(env: AppLinksEnv) {
  const team = env.APPLE_TEAM_ID ?? DEFAULT_APPLE_TEAM_ID;
  return {
    applinks: {
      details: [{ appIDs: IOS_BUNDLE_IDS.map((id) => `${team}.${id}`), components: APP_LINK_PATHS.map((path) => ({ "/": path })) }],
    },
  };
}

/** The two well-known files, or undefined for any other request. */
export function appLinksResponse(request: Request, env: AppLinksEnv): Response | undefined {
  if (request.method !== "GET" && request.method !== "HEAD") return undefined;
  const { pathname } = new URL(request.url);
  const body =
    pathname === "/.well-known/assetlinks.json"
      ? assetLinks(env)
      : pathname === "/.well-known/apple-app-site-association"
        ? appleAppSiteAssociation(env)
        : undefined;
  if (body === undefined) return undefined;
  return new Response(request.method === "HEAD" ? null : JSON.stringify(body), {
    headers: { "content-type": "application/json", "cache-control": "public, max-age=3600" },
  });
}
