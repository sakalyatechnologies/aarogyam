// Which API routes a clinic's website address may reach. Kept free of Worker types so the site
// app's tests can import it (web/apps/site/src/worker-routes.test.ts).

const PUBLIC_PHOTO = /^\/api\/v1\/public\/site\/photos\/[0-9a-f-]{36}$/;

/** Only reads of the published site and its pictures; everything else under `/api` is refused. */
export function isPublicSiteRoute(method: string, pathname: string): boolean {
  if (method !== "GET" && method !== "HEAD") return false;
  return pathname === "/api/v1/public/site" || PUBLIC_PHOTO.test(pathname);
}
