import { Check } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router";

import { useDocumentTitle } from "@aarogyam/app-kit";

import { PageHeader } from "../../components/mk/index.js";
import { GUIDES_BASE, ROLE_GROUPS, lengthLabel, parseGuideIndex, type GuideIndexEntry } from "./types.js";
import { useWatched } from "./watched.js";
import "./guides.css";

type Loaded = { state: "loading" } | { state: "missing" } | { state: "ready"; guides: GuideIndexEntry[] };

/** /guides: the short narrated guides, grouped by who they are for, with "Start here" first. */
export function GuidesPage({ base = GUIDES_BASE }: { base?: string }) {
  useDocumentTitle("Guides");
  const [loaded, setLoaded] = useState<Loaded>({ state: "loading" });
  const watched = useWatched();
  useEffect(() => {
    let live = true;
    fetch(`${base}/index.json`)
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        return parseGuideIndex(await res.json());
      })
      .then((index) => {
        if (live) setLoaded(index === undefined ? { state: "missing" } : { state: "ready", guides: index.guides });
      })
      .catch(() => {
        if (live) setLoaded({ state: "missing" });
      });
    return () => {
      live = false;
    };
  }, [base]);

  const card = (guide: GuideIndexEntry, featured: boolean) => (
    <li key={guide.id} className={featured ? "gl-card gl-featured" : "gl-card"}>
      <Link to={`/guides/${guide.id}`} className="gl-link">
        <img src={`${base}/${guide.still}`} alt="" loading="lazy" width={1366} height={768} />
        <span className="gl-body">
          {featured ? <span className="gl-start">Start here</span> : null}
          <span className="gl-title">{guide.title}</span>
          <span className="gl-sub">{guide.summary}</span>
          <span className="gl-meta">
            {lengthLabel(guide.seconds)} · {guide.steps} steps
            {watched.has(guide.id) ? (
              <span className="gl-watched">
                <Check aria-hidden="true" /> Watched
              </span>
            ) : null}
          </span>
        </span>
      </Link>
    </li>
  );

  return (
    <div className="mk-panel gl">
      <PageHeader title="Guides" subtitle="Short narrated guides for every main job. Pause, skip, or go through them as slides." />
      {loaded.state === "loading" ? <p className="gp-empty" role="status">Loading the guides…</p> : null}
      {loaded.state === "missing" ? <p className="gp-empty">The guides are not available right now.</p> : null}
      {loaded.state === "ready"
        ? ROLE_GROUPS.map(({ role, label }) => {
            const guides = loaded.guides.filter((g) => g.role === role).sort((a, b) => a.order - b.order);
            if (guides.length === 0) return null;
            return (
              <section key={role} className="gl-group" aria-labelledby={`gl-${role}`}>
                <h2 id={`gl-${role}`}>{label}</h2>
                <ul className="gl-grid">{guides.map((g, i) => card(g, role === "getting-started" && i === 0))}</ul>
              </section>
            );
          })
        : null}
    </div>
  );
}
