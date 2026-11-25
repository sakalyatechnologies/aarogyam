import { useEffect, useState } from "react";

import { GuidePlayer } from "./guide-player.js";
import { GUIDES_BASE, parsePublishedGuide, type PublishedGuide } from "./types.js";

type Loaded = { state: "loading" } | { state: "missing" } | { state: "ready"; guide: PublishedGuide };

/** Fetches one guide's `guide.json` and plays it. Shared by the guide page and the "?" side sheet. */
export function GuideLoader({ id, base = GUIDES_BASE }: { id: string; base?: string }) {
  return <Loading key={`${base}/${id}`} id={id} base={base} />;
}

function Loading({ id, base }: { id: string; base: string }) {
  const [loaded, setLoaded] = useState<Loaded>({ state: "loading" });
  useEffect(() => {
    let live = true;
    fetch(`${base}/${id}/guide.json`)
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        return parsePublishedGuide(await res.json());
      })
      .then((guide) => {
        if (live) setLoaded(guide === undefined ? { state: "missing" } : { state: "ready", guide });
      })
      .catch(() => {
        if (live) setLoaded({ state: "missing" });
      });
    return () => {
      live = false;
    };
  }, [id, base]);
  if (loaded.state === "loading") return <p className="gp-empty" role="status">Loading the guide…</p>;
  if (loaded.state === "missing") return <p className="gp-empty">This guide is not available yet.</p>;
  return <GuidePlayer guide={loaded.guide} base={base} />;
}
