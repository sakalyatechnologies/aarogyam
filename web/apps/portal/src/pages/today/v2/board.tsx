import { Component, useMemo, type ReactNode } from "react";

import type { DashboardCatalogue, DashboardLayout } from "@aarogyam/api-client";
import { EmptyState } from "@sakalya/ui";

import { useClinic } from "../../../clinic.js";
import { EditChrome, EmptyZone, type BoardEdit } from "./board-edit.js";
import { BoardContext, type BoardState } from "./board-context.js";
import { inZone, optsOf, shownItems, type ShownItem } from "./layout-model.js";
import { useDayToday } from "./queries.js";
import { entryOf, isKnownWidget } from "./registry.js";
import "./today-v2.css";

/** A widget that throws shows its own message; the rest of the board carries on. */
class WidgetBoundary extends Component<{ label: string; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    return this.state.failed ? (
      <div role="alert" className="tv2-card tv2-broken">
        {this.props.label} could not be drawn. Reload to try again.
      </div>
    ) : (
      this.props.children
    );
  }
}

function Cell({ shown, catalogue, edit, railSide }: { shown: ShownItem; catalogue: DashboardCatalogue; edit?: BoardEdit | undefined; railSide: string }) {
  const entry = entryOf(shown.item.key);
  if (entry === undefined) return null;
  const Widget = entry.render;
  const body = (
    <WidgetBoundary label={shown.spec.label}>
      <Widget spec={shown.spec} opts={optsOf(shown.spec, shown.item)} zone={shown.zone} catalogue={catalogue} />
    </WidgetBoundary>
  );
  if (edit === undefined) {
    return (
      <div className="tv2-cell" data-widget={shown.item.key} data-size={shown.item.size}>
        {body}
      </div>
    );
  }
  const key = shown.item.key;
  const here = edit.drop?.anchor === key && edit.dragging !== key ? edit.drop : undefined;
  return (
    <div
      className="tv2-cell"
      data-widget={key}
      data-size={shown.item.size}
      data-editing="1"
      data-dragging={edit.dragging === key ? "1" : undefined}
      data-resizing={edit.resizing === key ? "1" : undefined}
      data-drop={here?.ok === true ? here.side : undefined}
      data-axis={shown.zone === "main" && shown.item.size !== "full" ? "x" : "y"}
    >
      <div className="tv2-edit-body" inert>
        {body}
      </div>
      <EditChrome edit={edit} widget={key} label={shown.spec.label} zone={shown.zone} size={shown.item.size} sizes={shown.spec.sizes} railSide={railSide} />
    </div>
  );
}

export interface BoardProps {
  layout: DashboardLayout;
  catalogue: DashboardCatalogue;
  /** The chosen day, or `undefined` for the current one. */
  date?: string | undefined;
  onDateChange?: (date: string | undefined) => void;
  /** The Studio's preview: same widgets, nothing the person can press. */
  preview?: boolean;
  /** The Studio's edit mode: cards get handles to drag, resize, move and remove them. Implies `preview`. */
  edit?: BoardEdit | undefined;
}

/**
 * The Today board, drawn from a saved layout: a top strip, a 12-column main grid and a side rail, with the layout's
 * density, card style and rail side. The member sees only the widgets `can()` allows. Today and the Studio's preview
 * both render through this component, so they cannot drift apart.
 */
export function Board({ layout, catalogue, date, onDateChange, preview: asPreview = false, edit }: BoardProps) {
  const preview = asPreview || edit !== undefined;
  const { can } = useClinic();
  const now = useDayToday(undefined);
  const state = useMemo<BoardState>(() => ({ date, setDate: onDateChange ?? (() => undefined), todayIso: now.data?.date, preview }), [date, onDateChange, now.data?.date, preview]);
  const items = shownItems(layout, catalogue, can, isKnownWidget);
  const top = inZone(items, "top");
  const main = inZone(items, "main");
  const rail = inZone(items, "rail");
  const side = layout.rail.side === "left" ? "left" : "right";
  const cell = (shown: ShownItem) => <Cell key={shown.item.key} shown={shown} catalogue={catalogue} edit={edit} railSide={side} />;
  const zoneProps = (zone: "top" | "main" | "rail") => ({ "data-zone": edit === undefined ? undefined : zone, "data-drop-zone": edit?.zoneState(zone) });
  const railNode =
    rail.length === 0 && edit === undefined ? null : (
      <aside className="tv2-rail" aria-label={edit === undefined ? "Side panel" : "Side panel in the preview"} {...zoneProps("rail")}>
        {rail.length === 0 ? <EmptyZone zone="rail" /> : rail.map(cell)}
      </aside>
    );
  return (
    <BoardContext value={state}>
      <div className="tv2" data-density={layout.density} data-card={layout.card} data-side={side} data-rail-width={layout.rail.width} data-tpl={layout.tpl} data-preview={preview ? "1" : undefined}>
        {items.length === 0 && edit === undefined ? (
          <EmptyState title="Nothing to show yet" description="Your role sees none of the widgets in this layout. Open the Dashboard studio to add some." />
        ) : null}
        {top.length === 0 && edit === undefined ? null : (
          <div className="tv2-top" {...zoneProps("top")}>
            {top.length === 0 ? <EmptyZone zone="top" /> : top.map(cell)}
          </div>
        )}
        {main.length === 0 && rail.length === 0 && edit === undefined ? null : (
          <div className="tv2-body" data-has-rail={railNode === null ? "no" : "yes"}>
            {side === "left" ? railNode : null}
            <div className="tv2-main" {...zoneProps("main")}>
              {main.length === 0 && edit !== undefined ? <EmptyZone zone="main" /> : main.map(cell)}
            </div>
            {side === "right" ? railNode : null}
          </div>
        )}
      </div>
    </BoardContext>
  );
}
