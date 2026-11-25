// "If you wait" in Show patient (audit §3): what waiting usually leads to, in the API's words, with the
// recorded stage first. Pictures come from the recorded decay when the tooth has one; otherwise words only.
// General guidance, never a prediction. Hidden on a tooth that already has a treatment under way.
import { useMemo, type ReactElement } from "react";

import type { PresentSituation } from "@aarogyam/api-client";

import { ArtSvg } from "../mouth-art/react.js";
import type { ShapeSet, ToothArt } from "../mouth-art/types.js";
import { ifWaitFrames, type SnapTooth } from "../mouth-view/model.js";
import { waitScenes } from "../mouth-view/wait-scenes.js";
import { IllustrationBadge } from "./blocks.js";

export interface WaitArt { tooth: ToothArt; shapes: ShapeSet }

export function IfWaitStrip({ situation, tooth, record, art }: { situation: PresentSituation; tooth: number; record: SnapTooth | undefined; art: WaitArt | undefined }): ReactElement | null {
  // a situation chosen from the plan alone is not a recorded problem: no claim about what waiting does
  const stages = situation.from_plan === true ? [] : (situation.if_wait ?? []);
  const frames = useMemo(() => {
    const w = ifWaitFrames(record);
    return w !== undefined && w.frames.length <= stages.length ? w : undefined;
  }, [record, stages.length]);
  const scenes = useMemo(() => (frames === undefined || art === undefined ? undefined : waitScenes(frames, art.tooth, art.shapes, tooth)), [frames, art, tooth]);
  if (stages.length === 0) return null;
  // the recorded picture leads, the last picture ends it; a stage with no matching picture stays words only
  const last = (frames?.frames.length ?? 0) - 1;
  const sceneAt = (i: number) => scenes?.[i < last ? i : i === stages.length - 1 ? last : -1];
  const now = Math.max(0, stages.findIndex((s) => s.stage.toLowerCase() === "now"));
  return (
    <section className="ps-wait-strip" aria-label={`If you wait: ${situation.title}`} data-if-wait={situation.key}>
      <h4 className="ps-h">If you wait</h4>
      <ol className="ps-wait-row">
        {stages.map((s, i) => (
          <li key={`${s.stage}-${String(i)}`} className="ps-wait-f" data-now={i === now ? "" : undefined}>
            {(() => { const sc = sceneAt(i); return sc === undefined ? null : <div className="ps-wait-art"><ArtSvg scene={sc} label={`${s.stage}: ${s.words}`} /></div>; })()}
            <span className="ps-wait-tag">{s.stage}</span>
            <span className="ps-wait-w">{s.words}</span>
          </li>
        ))}
      </ol>
      <IllustrationBadge>Illustration · general guidance</IllustrationBadge>
    </section>
  );
}
