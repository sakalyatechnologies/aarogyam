// Choose your cap (present-studio-design §8.4, slice 2c): the crown, filling or implant-crown materials compared on
// the tooth itself. Words, outcomes and the illustration's look come from specialties/dental/present/materials.json
// and outcomes.json; `strength` and `best_for` show only when a clinic has filled them. The cost level is a relative
// guide, never a price.
import { useEffect, useState, type ReactElement } from "react";

import materialsFile from "../../../../../specialties/dental/present/materials.json" with { type: "json" };
import outcomesFile from "../../../../../specialties/dental/present/outcomes.json" with { type: "json" };
import { loadShapes, loadToothArt, toothTypeOf } from "../mouth-art/loaders.js";
import { overlayPart, type Overlay } from "../mouth-art/overlays.js";
import { ArtSvg } from "../mouth-art/react.js";
import { toothScene } from "../mouth-art/scene.js";
import type { Scene, ShapeSet, ToothArt, ViewName } from "../mouth-art/types.js";
import type { SnapTooth } from "../mouth-view/model.js";
import { IllustrationBadge, RecordBadge } from "./blocks.js";
import { useStudio } from "./options.js";

interface MaterialDef {
  key: string;
  label: string;
  summary: string;
  looks_like: string;
  look: { paint: string; translucency: string; opacity: string; metal: boolean; margin_line: string };
  outcome?: string;
  cost_tier: number;
  strength: string;
  best_for: string;
}
interface GroupDef { title: string; intro: string; overlay: string; materials: MaterialDef[] }
interface OutcomeDef { words?: string; why?: string; source?: string; source_quote?: string }

const groups: Record<string, GroupDef> = materialsFile.groups;
const outcomes: Record<string, OutcomeDef> = outcomesFile.outcomes;

/** Which group of materials suits what is recorded on a tooth, or none. */
export function materialGroupFor(situationKeys: readonly string[], t: SnapTooth | undefined): string | undefined {
  if (t?.finding === "crown" || situationKeys.includes("deep_decay")) return "crown";
  if (t?.finding === "implant" || situationKeys.includes("missing")) return "implant_crown";
  if (t?.finding === "filled" || (t?.finding === "caries" && t.details?.caries_depth !== "near_pulp")) return "filling";
  return undefined;
}

const overlayOf = (group: GroupDef, material: string): Overlay => {
  if (group.overlay === "implant") return { kind: "implant", material };
  if (group.overlay === "filled") return { kind: "filled", surfaces: ["O"], material };
  return { kind: "crown", material };
};

/** One material painted on the tooth (the crown from the front, a filling from the biting side). */
export function materialScene(art: ToothArt, shapes: ShapeSet, tooth: number, group: GroupDef, material: string): Scene {
  const view: ViewName = group.overlay === "filled" ? "top" : "front";
  return toothScene(art, view, { fdi: tooth, shapes, parts: [{ add: [] }, overlayPart(art, view, overlayOf(group, material))] });
}

const level = (n: number) => "●".repeat(n) + "○".repeat(Math.max(0, 4 - n));

function Outcome({ def }: { def: MaterialDef }): ReactElement {
  const o = def.outcome === undefined ? undefined : outcomes[def.outcome];
  if (o?.words === undefined) return <span className="ps-muted">No usual figure</span>;
  const cited = o.source !== undefined && o.source_quote !== undefined;
  return (
    <span className="ps-opt-life">
      <b>{o.words}</b>
      <small>General guidance, not a promise. Your dentist will advise.</small>
      {o.why === undefined ? null : (
        <details>
          <summary>Why we say this</summary>
          <span>{o.why}</span>
          {cited ? <small>{`Source: ${o.source ?? ""}`}</small> : null}
          {cited ? <q>{o.source_quote}</q> : null}
        </details>
      )}
    </span>
  );
}

export interface MaterialChoiceProps { group: string; tooth: number }

/** The materials of one group side by side, each painted on this tooth. */
export function MaterialChoice({ group: key, tooth }: MaterialChoiceProps): ReactElement | null {
  const def = groups[key];
  const [art, setArt] = useState<{ tooth: ToothArt; shapes: ShapeSet } | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const type = toothTypeOf(tooth);
  useEffect(() => {
    let live = true;
    if (type === undefined) return;
    void Promise.all([loadToothArt(type), loadShapes()]).then(([t, shapes]) => { if (live) setArt({ tooth: t, shapes }); }, () => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [type]);
  if (def === undefined) return null;
  return (
    <section className="ps-opts ps-mats" aria-label={def.title} data-material-group={key}>
      <h4 className="ps-h">{def.title}<RecordBadge /></h4>
      <p className="ps-muted">{def.intro}</p>
      <ul className="ps-opt-list">
        {def.materials.map((m) => (
          <li key={m.key} className="ps-opt" data-material={m.key}>
            <b className="ps-opt-h">{m.label}</b>
            <div className="ps-pic-art">
              {art === undefined || failed ? null : <ArtSvg scene={materialScene(art.tooth, art.shapes, tooth, def, m.key)} label={`${m.label} on tooth ${String(tooth)}`} />}
            </div>
            <dl className="ps-opt-facts">
              <div data-row="what"><dt>What it is</dt><dd>{m.summary}</dd></div>
              <div data-row="look"><dt>How it looks</dt><dd>{m.looks_like}</dd></div>
              <div data-row="life"><dt>How long it usually lasts</dt><dd><Outcome def={m} /></dd></div>
              <div data-row="cost"><dt>Cost level</dt><dd><span role="img" aria-label={`Level ${String(m.cost_tier)} of 4, a guide and not a price`}>{level(m.cost_tier)}</span></dd></div>
              {m.strength === "" ? null : <div data-row="strength"><dt>Strength</dt><dd>{m.strength}<small>{" Your clinic's guidance"}</small></dd></div>}
              {m.best_for === "" ? null : <div data-row="best_for"><dt>Best for</dt><dd>{m.best_for}<small>{" Your clinic's guidance"}</small></dd></div>}
            </dl>
            <IllustrationBadge>Illustration · general guidance</IllustrationBadge>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** A tooth's materials block in its sheet: nothing unless the record or its situations point at one. */
export function ToothMaterials({ tooth, record }: { tooth: number; record: SnapTooth | undefined }): ReactElement | null {
  const keys = useStudio()?.situations.filter((s) => s.tooth === tooth).map((s) => s.key) ?? [];
  const group = materialGroupFor(keys, record);
  return group === undefined ? null : <MaterialChoice group={group} tooth={tooth} />;
}
