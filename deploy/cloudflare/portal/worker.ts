import { buildFetch, type Env } from "../shared/api-proxy.js";
import { appLinksResponse, type AppLinksEnv } from "./app-links.js";

/**
 * Patient links (`/shared/{token}`) get the small patient page (`shared.html`) instead of the
 * portal, unless `?full=1` asks for the portal's own page (prescriptions and records, which the
 * small page hands over). `/shared` resolves to `shared.html` under the default html_handling;
 * asking for `/shared.html` itself would answer with a redirect.
 */
export function patientPageRequest(request: Request): Request | undefined {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/shared/") || url.searchParams.has("full")) return undefined;
  if (request.method !== "GET" && request.method !== "HEAD") return undefined;
  return new Request(new URL("/shared", url), { method: request.method, headers: request.headers });
}

export default {
  fetch(request: Request, env: Env & AppLinksEnv) {
    const appLinks = appLinksResponse(request, env);
    if (appLinks !== undefined) return appLinks;
    const patientPage = patientPageRequest(request);
    return patientPage === undefined ? buildFetch(env)(request) : env.ASSETS.fetch(patientPage);
  },
};
