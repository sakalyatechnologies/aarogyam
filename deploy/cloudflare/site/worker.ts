// The clinic website Worker: serves the static site app (web/apps/site) and forwards only the
// two public read routes it needs to the API. No sign-in, no patient data: anything else under
// /api answers 404 here, so a clinic's site address can never reach a signed-in route.
//
// Each clinic's address (`<slug>-site.<account>.workers.dev`, later `<slug>-site.<domain>` or the
// clinic's own domain) is a tiny forwarding Worker made by the outbox job
// (crates/aarogyam-notify/src/addresses.rs) that hands the request here through a service binding,
// so the request URL carries the clinic's own host and the API picks the clinic from it.
// Booking is the portal's `/book` page, shown in a frame by the site (VITE_BOOKING_URL_TEMPLATE).
import { proxyApi, type Env } from "../shared/api-proxy.js";
import { isPublicSiteRoute } from "./routes.js";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/") || url.pathname === "/api") {
      if (!isPublicSiteRoute(request.method, url.pathname)) {
        return new Response("Not found", { status: 404 });
      }
      return proxyApi(request, env, { publicContent: true });
    }
    return env.ASSETS.fetch(request);
  },
};
