// Cloudflare Pages Function: forwards the three API calls the public site makes to the API through
// the shared edge proxy, which adds the edge secret the API requires. Anything else is 404.
//   POST /api/v1/registrations   clinic application (public)
//   GET  /api/v1/me              the signed-in person's clinics (bearer token)
//   POST /api/v1/auth/handoff    one-time code for the jump to a clinic host (bearer token)
// API_ORIGIN and EDGE_SECRET are Pages secrets that scripts/deploy-website.sh sets when given an
// API origin; without them the site shows an error instead of losing an application silently.
import { proxyApi, type Env } from "../../../shared/api-proxy";

type PagesEnv = Pick<Env, "API_ORIGIN" | "EDGE_SECRET"> & {
  /** The API's app host (`ARO_HOSTS__APP`): the site speaks to the API as that host, because the
   * API answers /me and registrations there and nowhere else. A var in wrangler.toml. */
  API_HOST?: string;
};

const ALLOWED: Record<string, string> = {
  "/api/v1/registrations": "POST",
  "/api/v1/me": "GET",
  "/api/v1/auth/handoff": "POST",
};

export const onRequest = async (context: { request: Request; env: PagesEnv }): Promise<Response> => {
  const { request, env } = context;
  const path = new URL(request.url).pathname.replace(/\/$/, "");
  if (ALLOWED[path] !== request.method) {
    return new Response("Not found", { status: 404 });
  }
  if (!env.API_ORIGIN || !env.EDGE_SECRET) {
    return new Response("The site is not connected to the API yet", { status: 503 });
  }
  // proxyApi never touches static assets; Pages serves those itself.
  // The edge proxy trusts the request's own host; present the app host instead of this site's.
  const target = env.API_HOST
    ? new Request(`https://${env.API_HOST}${new URL(request.url).pathname}`, request)
    : request;
  return proxyApi(target, { ...env, ASSETS: undefined as never });
};
