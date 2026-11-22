/**
 * A small tooth picture for a history card: the tooth's own art with what the visit recorded drawn on it (decay, a
 * filling, a crown, a root canal). The art module and each tooth type load on first use, so the page paints first.
 */
import { useEffect, useState } from "react";

type Overlay = import("@aarogyam/app-kit/mouth-art").Overlay;

/** The overlay a chart finding draws; none for findings the glyph can't show. */
function overlayOf(finding: string | null | undefined): Overlay | undefined {
  switch (finding) {
    case "caries":
      return { kind: "caries", surface: "O" };
    case "filled":
      return { kind: "filled", surfaces: ["O"] };
    case "crown":
      return { kind: "crown" };
    case "root_canal":
      return { kind: "root_canal" };
    case "missing":
      return { kind: "missing" };
    case "implant":
      return { kind: "implant" };
    default:
      return undefined;
  }
}

const cache = new Map<string, Promise<string | undefined>>();

/** The SVG markup for a tooth with a finding, built once per tooth and finding. */
function glyphSvg(tooth: number, finding: string | null | undefined): Promise<string | undefined> {
  const key = `${String(tooth)}:${finding ?? ""}`;
  let svg = cache.get(key);
  if (svg === undefined) {
    svg = import("@aarogyam/app-kit/mouth-art")
      .then(async (art) => {
        const type = art.toothTypeOf(tooth);
        if (type === undefined) return undefined;
        const toothArt = await art.loadToothArt(type);
        // The section shows crown and roots, so a filling, a crown and a root canal all read at this size.
        const view = "section";
        const overlay = overlayOf(finding);
        const parts = overlay === undefined ? [] : [art.overlayPart(toothArt, view, overlay)];
        return art.sceneToSvg(art.toothScene(toothArt, view, { fdi: tooth, parts }), { idPrefix: `hg${key.replace(/\W/g, "")}-` });
      })
      .catch(() => undefined);
    cache.set(key, svg);
  }
  return svg;
}

export function ToothGlyph({ tooth, finding }: { tooth: number; finding?: string | null | undefined }) {
  const [svg, setSvg] = useState<string | undefined>(undefined);
  useEffect(() => {
    let live = true;
    void glyphSvg(tooth, finding).then((markup) => {
      if (live) setSvg(markup);
    });
    return () => {
      live = false;
    };
  }, [tooth, finding]);
  // Generated from our own art data, never from user text.
  return svg === undefined ? <span className="hist-glyph" aria-hidden="true" /> : <span className="hist-glyph" aria-hidden="true" dangerouslySetInnerHTML={{ __html: svg }} />;
}
