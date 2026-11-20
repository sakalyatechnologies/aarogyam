/**
 * The visit page's mouth parts (design §1.4): the interactive mouth view hero, the "See" rows that
 * open a tooth in it, and the care-at-home brushing band (its art loads lazily per band).
 */
import { useEffect, useState, type ReactNode } from "react";

import type { MouthSnapshot } from "@aarogyam/api-client";
import { BAND_INFO, BrushingAnimation, loadBrushingArt, type BrushingArt, type BrushingBand } from "@aarogyam/app-kit/mouth-art";
import { MouthView, problemWords, toothInfo } from "@aarogyam/app-kit/mouth-view";
import "@aarogyam/app-kit/mouth-view.css";

/** The 3D tooth, fetched only when the patient taps "See in 3D". */
const load3d = () => import("@aarogyam/app-kit/real-teeth-3d");

export function MouthHero({ chart, name, open, onScreen }: { chart: MouthSnapshot; name: string; open: { tooth: number; nonce: number } | undefined; onScreen: () => void }) {
  return <MouthView snapshot={chart} name={name} open={open} load3d={load3d} onScreen={onScreen} className="vp-mouth" />;
}

/** One row that names a tooth; with a chart it opens that tooth in the mouth view. */
export function ToothRow({ tooth, canOpen, onOpen, children, dot, end }: { tooth: number | null | undefined; canOpen: boolean; onOpen: (tooth: number) => void; children: ReactNode; dot: string; end?: ReactNode }) {
  if (tooth === null || tooth === undefined || !canOpen) {
    return (
      <li className="vp-item">
        <span className={dot} aria-hidden="true" />
        <span className="vp-grow">{children}</span>
        {end}
      </li>
    );
  }
  return (
    <li>
      <button type="button" className="vp-item vp-linkrow" onClick={() => { onOpen(tooth); }}>
        <span className={dot} aria-hidden="true" />
        <span className="vp-grow">
          {children}
          <span className="vp-see">See tooth</span>
        </span>
        {end}
      </button>
    </li>
  );
}

/** "What we found": today's recorded problems, in patient words. */
export function foundRows(chart: MouthSnapshot | undefined): { tooth: number; words: string; where: string }[] {
  if (chart === undefined) return [];
  return chart.teeth.flatMap((t) => {
    if (t.today !== "found") return [];
    const words = problemWords(t).filter((w) => w !== "Missing tooth");
    return words.length === 0 ? [] : [{ tooth: t.tooth, words: words.join(", "), where: `${toothInfo(t.tooth).name} (${String(t.tooth)})` }];
  });
}

export function BrushingBlock({ band, highlight, name }: { band: BrushingBand; highlight: number | undefined; name: string }) {
  const [art, setArt] = useState<BrushingArt | undefined>(undefined);
  useEffect(() => {
    let live = true;
    void loadBrushingArt(band).then((a) => { if (live) setArt(a); }, () => undefined);
    return () => { live = false; };
  }, [band]);
  const info = BAND_INFO[band];
  const child = band === "general_under_6" || band === "general_6_12";
  return (
    <div className="vp-brush-wrap">
      <p className="vp-muted">{`${info.title}.${child ? ` Help ${name} brush.` : ""}`}</p>
      {art === undefined ? <div className="vp-brush vp-brush-wait" aria-hidden="true" /> : <BrushingAnimation art={art} band={band} className="vp-brush" {...(highlight === undefined ? {} : { highlight })} />}
      <div className="vp-chips">{info.chips.map((c) => <span key={c} className="vp-chip">{c}</span>)}</div>
    </div>
  );
}
