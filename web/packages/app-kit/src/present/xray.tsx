// Own X-ray (present-studio-design §6.3, slice 1e): the patient's real radiograph, never flipped, with the
// recorded findings beside it. Radiograph convention: the patient's right is on the viewer's left, so
// "Your right" sits on the left edge and "Your left" on the right edge. Nothing here mirrors or scales the
// image (review major 8); the conformance suite asserts it. Pins are drawn by the host (session-only until 2g).
import { useState, type CSSProperties, type ReactElement, type ReactNode } from "react";

import { FactList, ProvenanceFooter } from "./blocks.js";
import type { PresentModel } from "./model.js";
import { ToothSheet, type ToothSheetProps } from "./tooth-sheet.js";

/** The two edge labels, by radiograph convention. */
export const XRAY_EDGES = { left: "Your right", right: "Your left" } as const;

/** The edge labels. `rect` (the drawn image's left and width inside its stage, in pixels) pins them to the image's own edges. */
export function XrayEdges({ rect }: { rect?: { left: number; width: number } | undefined }): ReactElement {
  const placed = rect !== undefined && rect.width > 0;
  const at = (side: "left" | "right"): CSSProperties | undefined => {
    if (!placed) return undefined;
    return side === "left" ? { left: rect.left + 8, right: "auto" } : { left: rect.left + rect.width - 8, right: "auto", translate: "-100% 0" };
  };
  return (
    <>
      <span className="ps-xr-edge" data-side="left" style={at("left")}>{XRAY_EDGES.left}</span>
      <span className="ps-xr-edge" data-side="right" style={at("right")}>{XRAY_EDGES.right}</span>
    </>
  );
}

/** A plain, unflipped radiograph with its edge labels and a dated caption ("X-ray from 2 Oct"). */
export function XrayView({ src, alt, caption }: { src: string | undefined; alt: string; caption?: string | undefined }): ReactElement {
  return (
    <figure className="ps-xr-fig">
      <div className="ps-xr-stage" data-xray-stage="">
        {src === undefined ? <div className="ps-wait" role="status" aria-label="Loading the X-ray" /> : <img className="ps-xr-img" src={src} alt={alt} draggable={false} />}
        <XrayEdges />
      </div>
      {caption === undefined ? null : <figcaption className="ps-muted">{caption}</figcaption>}
    </figure>
  );
}

export interface XrayProps {
  model: PresentModel;
  /** The host's image with the doctor's session pins; without it a plain `image` is shown. */
  stage?: ReactNode;
  image?: { src: string | undefined; alt: string; caption?: string | undefined } | undefined;
  load3d?: ToothSheetProps["load3d"];
}

export function XrayStyle({ model, stage, image, load3d }: XrayProps): ReactElement {
  const [sheet, setSheet] = useState<number | undefined>(undefined);
  return (
    <div className="ps-xray" data-present-style="xray">
      <div className="ps-xr-main">
        {stage ?? (image === undefined ? null : <XrayView src={image.src} alt={image.alt} caption={image.caption} />)}
        <ProvenanceFooter recorded={["The image is the patient's own X-ray, as it was taken. The list is this visit's record."]} illustration={[]} />
      </div>
      <div className="ps-xr-side">
        {sheet === undefined
          ? <FactList model={model} numbered={false} onOpen={setSheet} />
          : <ToothSheet model={model} tooth={sheet} load3d={load3d} onBack={() => { setSheet(undefined); }} />}
      </div>
    </div>
  );
}

/** The style module's shape (§6). */
export const xrayStyle = { id: "xray" as const, label: "Own X-ray", Component: XrayStyle };
