import { useCallback, useEffect, useState } from "react";

import type { ApiClient, SitePage } from "@aarogyam/api-client";
import { ClinicSite, applySeo, paletteOf, seoFor, type PageId } from "@aarogyam/site-kit";
import "@aarogyam/site-kit/styles.css";

import { bookingUrl, type SiteEnv } from "./env.js";
import { hrefFor, pageFor } from "./routes.js";
import "./styles.css";

type State = { kind: "loading" } | { kind: "ready"; site: SitePage } | { kind: "unavailable" } | { kind: "failed" };

/** Loads the clinic's published site, which is whatever the API says this host's clinic published. */
function useSite(client: ApiClient): State {
  const [state, setState] = useState<State>({ kind: "loading" });
  useEffect(() => {
    const controller = new AbortController();
    void client.getPublicSite({ signal: controller.signal }).then((result) => {
      if (controller.signal.aborted) {
        return;
      }
      if (result.ok) {
        setState({ kind: "ready", site: result.value });
      } else {
        setState({ kind: result.error.status === 404 ? "unavailable" : "failed" });
      }
    });
    return () => {
      controller.abort();
    };
  }, [client]);
  return state;
}

/** The address bar is the page: `/about` opens About on a multi-page site. */
function usePage(): [PageId, (page: PageId) => void] {
  const [page, setPage] = useState<PageId>(() => pageFor(window.location.pathname));
  useEffect(() => {
    const onPop = () => {
      setPage(pageFor(window.location.pathname));
    };
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
    };
  }, []);
  const go = useCallback((next: PageId) => {
    window.history.pushState(null, "", hrefFor(next));
    setPage(next);
    window.scrollTo({ top: 0 });
  }, []);
  return [page, go];
}

function Notice({ title, children }: { title: string; children: string }) {
  return (
    <main className="site-notice">
      <h1>{title}</h1>
      <p>{children}</p>
    </main>
  );
}

export function App({ client, env }: { client: ApiClient; env: SiteEnv }) {
  const state = useSite(client);
  const [page, go] = usePage();
  const site = state.kind === "ready" ? state.site : null;
  const multi = site?.design.layout === "multi";
  const current: PageId = multi ? page : "home";

  useEffect(() => {
    if (site === null) {
      return;
    }
    applySeo(document, seoFor(site, current, window.location.origin), paletteOf(site.design.template, site.design.palette).bg);
  }, [site, current]);

  const unavailable = state.kind === "unavailable" || state.kind === "failed";
  useEffect(() => {
    if (unavailable) {
      document.title = "Website not available";
    }
  }, [unavailable]);

  switch (state.kind) {
    case "loading":
      return (
        <div className="site-loading" role="status" aria-label="Loading">
          <span />
        </div>
      );
    case "unavailable":
      return <Notice title="This website is not available yet">The clinic has not published it. Please check back soon.</Notice>;
    case "failed":
      return <Notice title="We could not load this website">Please check your connection and try again.</Notice>;
    case "ready":
      return (
        <ClinicSite
          site={state.site}
          page={current}
          onNavigate={go}
          hrefFor={hrefFor}
          bookingUrl={bookingUrl(env.bookingUrlTemplate, window.location.hostname)}
        />
      );
  }
}
