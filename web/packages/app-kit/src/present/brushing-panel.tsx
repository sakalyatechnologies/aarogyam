// "How to brush" in Present (§1.4): loaded only when the doctor taps the chip.
import { useEffect, useState } from "react";

import { BAND_INFO, BrushingAnimation, loadBrushingArt, type BrushingArt, type BrushingBand } from "@aarogyam/app-kit/mouth-art";

export function BrushingPanel({ band, name, onClose }: { band: BrushingBand; name: string | undefined; onClose: () => void }) {
  const [art, setArt] = useState<BrushingArt | undefined>(undefined);
  useEffect(() => {
    let live = true;
    void loadBrushingArt(band).then((a) => { if (live) setArt(a); }, () => undefined);
    return () => { live = false; };
  }, [band]);
  const info = BAND_INFO[band];
  const child = band === "general_under_6" || band === "general_6_12";
  return (
    <div className="pm-brush" role="dialog" aria-modal="true" aria-label={info.title} onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } }}>
      <div className="pm-brush-card">
        <div className="pm-brush-head">
          <h2>{info.title}</h2>
          <button type="button" className="pm-chip" onClick={onClose} autoFocus>Close</button>
        </div>
        {child && name !== undefined ? <p className="pm-muted">{`Help ${name} brush.`}</p> : null}
        {art === undefined ? <div className="pm-brush-wait" aria-hidden="true" /> : <BrushingAnimation art={art} band={band} className="pm-brush-art" />}
        <div className="pm-chips">{info.chips.map((c) => <span key={c} className="mv-chip">{c}</span>)}</div>
      </div>
    </div>
  );
}
