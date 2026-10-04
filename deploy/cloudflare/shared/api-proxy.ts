// Shared by every app's Worker. Proxies `/api/*` to the Rust API (Cloud Run today, or a
// Cloudflare Tunnel URL in front of a developer's machine for a same-day demo) and serves
// everything else from Workers static assets, with an SPA fallback configured in wrangler.toml.
//
// Trust boundary (see docs/architecture.md "Trust boundaries"): the API only trusts
// `X-Forwarded-Host` and `cf-connecting-ip` when they arrive with the edge secret. So this
// Worker strips any client-sent copies of the three headers first, then sets its own from
// values Cloudflare itself vouches for (the request's own `Host` and the real connecting IP),
// never from anything the client could have set upstream of Cloudflare.

export interface Env {
  /** Workers static assets for this app's Vite build. */
  ASSETS: Fetcher;
  /** Base URL of the API: a Cloud Run service or a `trycloudflare.com` tunnel. No trailing slash. */
  API_ORIGIN: string;
  /** The same secret the API verifies as `ARO_HTTP__EDGE_SECRET` (Worker secret, not a var). */
  EDGE_SECRET: string;
}

const STRIPPED_REQUEST_HEADERS = ["x-forwarded-host", "cf-connecting-ip", "x-sakalya-edge"];

export async function proxyApi(request: Request, env: Env): Promise<Response> {
  if (!env.API_ORIGIN) {
    return new Response("API_ORIGIN is not configured", { status: 502 });
  }
  const incoming = new URL(request.url);
  // Capture Cloudflare's own values before stripping anything the client may have sent.
  const trustedHost = incoming.host;
  const trustedClientIp = request.headers.get("cf-connecting-ip") ?? "";

  const origin = new URL(env.API_ORIGIN);
  const target = new URL(incoming.pathname + incoming.search, origin);

  const headers = new Headers(request.headers);
  for (const name of STRIPPED_REQUEST_HEADERS) headers.delete(name);
  headers.set("host", origin.host);
  headers.set("x-forwarded-host", trustedHost);
  if (trustedClientIp) headers.set("cf-connecting-ip", trustedClientIp);
  headers.set("x-sakalya-edge", env.EDGE_SECRET);

  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  const upstream = await fetch(target.toString(), {
    method: request.method,
    headers,
    body: hasBody ? request.body : undefined,
    redirect: "manual",
  });

  const responseHeaders = new Headers(upstream.headers);
  // Patient data must never be cached at the edge, regardless of what the API sends.
  responseHeaders.set("cache-control", "no-store");
  return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
}

export function buildFetch(env: Env) {
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      return proxyApi(request, env);
    }
    return env.ASSETS.fetch(request);
  };
}
