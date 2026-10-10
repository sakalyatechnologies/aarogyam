import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, GripVertical, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type RefObject } from "react";

import type { DashboardCatalogue, DashboardLayout } from "@aarogyam/api-client";

import {
  SIZE_LABEL,
  SIZE_SPAN,
  ZONE_LABEL,
  canStep,
  dropInZone,
  isZone,
  nearestSize,
  patchItem,
  removeAt,
  sideStepZone,
  sizesOf,
  specOf,
  stepSize,
  stepWidget,
  zoneAllowed,
  type DropPlace,
  type Step,
  type Zone,
} from "./layout-model.js";
import { locate, type Box, type CellBox, type ZoneBox } from "./studio-dnd.js";

/** What a zone looks like while a card is being dragged: it takes the card, it is the one under the pointer, or it refuses it. */
export type ZoneState = "can" | "ok" | "no";

/** A card's edit controls and the state of any drag, for the Board to draw. Made by `useBoardEdit`. */
export interface BoardEdit {
  /** The key being dragged, if any. */
  dragging: string | undefined;
  /** Where it would land, and whether that is allowed. */
  drop: (DropPlace & { ok: boolean }) | undefined;
  /** The key being resized, if any. */
  resizing: string | undefined;
  zoneState: (zone: Zone) => ZoneState | undefined;
  can: (key: string, step: Step) => boolean;
  step: (key: string, step: Step) => void;
  remove: (key: string) => void;
  resizeKey: (key: string, direction: -1 | 1 | "min" | "max") => void;
  startDrag: (key: string, event: ReactPointerEvent) => void;
  startResize: (key: string, event: ReactPointerEvent) => void;
}

const boxOf = (el: Element): Box => {
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
};

/**
 * Direct manipulation on the Studio's preview, with native pointer events: drag a card by its handle to another place
 * or zone, drag its corner to a new size, or use the buttons and arrow keys. Every edit goes through the layout model,
 * so only the sizes and zones the catalogue allows ever get in: a refused drop leaves the layout as it was.
 */
export function useBoardEdit({ layout, catalogue, onChange, root }: { layout: DashboardLayout; catalogue: DashboardCatalogue; onChange: (next: DashboardLayout) => void; root: RefObject<HTMLElement | null> }): { edit: BoardEdit; note: string; ghost: { x: number; y: number; label: string } | undefined } {
  const [dragging, setDragging] = useState<string | undefined>(undefined);
  const [drop, setDrop] = useState<(DropPlace & { ok: boolean }) | undefined>(undefined);
  const [resizing, setResizing] = useState<string | undefined>(undefined);
  const [note, setNote] = useState("");
  const [ghost, setGhost] = useState<{ x: number; y: number; label: string } | undefined>(undefined);
  const latest = useRef({ layout, catalogue, onChange });
  useEffect(() => {
    latest.current = { layout, catalogue, onChange };
  });
  const cleanup = useRef<(() => void) | undefined>(undefined);
  useEffect(() => () => { cleanup.current?.(); }, []);

  const labelOf = (key: string) => specOf(latest.current.catalogue, key)?.label ?? key;
  const apply = (next: DashboardLayout) => {
    if (next !== latest.current.layout) latest.current.onChange(next);
  };

  /** The zones and cards on the preview, measured now. */
  const measure = () => {
    const zones: ZoneBox[] = [];
    const cells: CellBox[] = [];
    root.current?.querySelectorAll<HTMLElement>("[data-zone]").forEach((el) => {
      const zone = el.dataset["zone"] ?? "";
      if (isZone(zone)) zones.push({ zone, box: boxOf(el) });
    });
    root.current?.querySelectorAll<HTMLElement>("[data-widget]").forEach((el) => {
      const zone = el.closest<HTMLElement>("[data-zone]")?.dataset["zone"] ?? "";
      const key = el.dataset["widget"];
      if (key !== undefined && isZone(zone)) cells.push({ key, zone, box: boxOf(el), wide: zone !== "main" || el.dataset["size"] === "full" });
    });
    return { zones, cells };
  };

  const startDrag = useCallback((key: string, event: ReactPointerEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    cleanup.current?.();
    const from = { x: event.clientX, y: event.clientY };
    let active = false;
    const where = (x: number, y: number) => {
      const { zones, cells } = measure();
      const place = locate(x, y, zones, cells, key);
      return place === undefined ? undefined : { ...place, ok: zoneAllowed(latest.current.catalogue, key, place.zone) };
    };
    const move = (e: PointerEvent) => {
      if (!active && Math.hypot(e.clientX - from.x, e.clientY - from.y) < 4) return;
      if (!active) {
        active = true;
        setDragging(key);
        setNote("");
      }
      setGhost({ x: e.clientX, y: e.clientY, label: labelOf(key) });
      setDrop(where(e.clientX, e.clientY));
    };
    const end = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
      document.removeEventListener("pointercancel", cancel);
      document.removeEventListener("keydown", escape);
      cleanup.current = undefined;
      setDragging(undefined);
      setDrop(undefined);
      setGhost(undefined);
    };
    const up = (e: PointerEvent) => {
      const place = active ? where(e.clientX, e.clientY) : undefined;
      end();
      if (place === undefined) {
        if (active) setNote(`${labelOf(key)} went back to where it was.`);
        return;
      }
      if (!place.ok) {
        setNote(`${labelOf(key)} cannot go in the ${ZONE_LABEL[place.zone].toLowerCase()}, so it went back.`);
        return;
      }
      const target: DropPlace = { zone: place.zone, anchor: place.anchor, side: place.side };
      const next = dropInZone(latest.current.layout, key, target, latest.current.catalogue);
      apply(next);
      setNote(next === latest.current.layout ? `${labelOf(key)} stays where it is.` : `${labelOf(key)} moved to the ${ZONE_LABEL[place.zone].toLowerCase()}.`);
    };
    const cancel = () => {
      end();
      setNote(`${labelOf(key)} went back to where it was.`);
    };
    const escape = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") cancel();
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
    document.addEventListener("pointercancel", cancel);
    document.addEventListener("keydown", escape);
    cleanup.current = end;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startResize = useCallback((key: string, event: ReactPointerEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    cleanup.current?.();
    const cell = root.current?.querySelector<HTMLElement>(`[data-widget="${key}"]`);
    const main = cell?.closest<HTMLElement>("[data-zone]");
    if (cell === undefined || cell === null || main === null || main === undefined) return;
    const startWidth = cell.getBoundingClientRect().width;
    const column = main.getBoundingClientRect().width / 12;
    const startX = event.clientX;
    setResizing(key);
    const move = (e: PointerEvent) => {
      const spec = specOf(latest.current.catalogue, key);
      const index = latest.current.layout.items.findIndex((item) => item.key === key);
      const item = latest.current.layout.items[index];
      if (spec === undefined || item === undefined || column <= 0) return;
      const size = nearestSize(spec, (startWidth + (e.clientX - startX)) / column);
      if (size !== item.size) {
        apply(patchItem(latest.current.layout, index, { size }));
        setNote(`${spec.label} is now ${(SIZE_LABEL[size] ?? size).toLowerCase()}.`);
      }
    };
    const end = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", end);
      document.removeEventListener("pointercancel", end);
      cleanup.current = undefined;
      setResizing(undefined);
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", end);
    document.addEventListener("pointercancel", end);
    cleanup.current = end;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const edit = useMemo<BoardEdit>(
    () => ({
      dragging,
      drop,
      resizing,
      zoneState: (zone) => {
        if (dragging === undefined) return undefined;
        if (drop?.zone === zone) return drop.ok ? "ok" : "no";
        return zoneAllowed(catalogue, dragging, zone) ? "can" : undefined;
      },
      can: (key, step) => canStep(layout, key, step, catalogue),
      step: (key, step) => {
        const before = layout;
        const next = stepWidget(before, key, step, catalogue);
        if (next === before) return;
        apply(next);
        const zone = next.items.find((item) => item.key === key)?.zone;
        setNote(zone !== undefined && isZone(zone) ? `${labelOf(key)} moved ${step === "up" || step === "down" ? step : `to the ${ZONE_LABEL[zone].toLowerCase()}`}.` : "");
      },
      remove: (key) => {
        const index = layout.items.findIndex((item) => item.key === key);
        if (index < 0) return;
        apply(removeAt(layout, index));
        setNote(`${labelOf(key)} removed.`);
      },
      resizeKey: (key, direction) => {
        const spec = specOf(catalogue, key);
        const index = layout.items.findIndex((item) => item.key === key);
        const item = layout.items[index];
        if (spec === undefined || item === undefined) return;
        const sizes = sizesOf(spec);
        const size = direction === "min" ? sizes[0] : direction === "max" ? sizes[sizes.length - 1] : stepSize(spec, item.size, direction);
        if (size === undefined || size === item.size) return;
        apply(patchItem(layout, index, { size }));
        setNote(`${spec.label} is now ${(SIZE_LABEL[size] ?? size).toLowerCase()}.`);
      },
      startDrag,
      startResize,
    }),
    [dragging, drop, resizing, layout, catalogue, startDrag, startResize],
  );
  return { edit, note, ghost };
}

/** The controls laid over one card of the preview. They stay one size on screen however far the preview is scaled down. */
export function EditChrome({ edit, widget, label, zone, size, sizes, railSide }: { edit: BoardEdit; widget: string; label: string; zone: Zone; size: string; sizes: readonly string[]; railSide: string }) {
  const left = sideStepZone(zone, "left", railSide);
  const right = sideStepZone(zone, "right", railSide);
  const buttons: { step: Step; icon: typeof ArrowUp; name: string }[] = [
    { step: "left", icon: ArrowLeft, name: left === undefined ? "left" : `to the ${ZONE_LABEL[left].toLowerCase()}` },
    { step: "up", icon: ArrowUp, name: "up" },
    { step: "down", icon: ArrowDown, name: "down" },
    { step: "right", icon: ArrowRight, name: right === undefined ? "right" : `to the ${ZONE_LABEL[right].toLowerCase()}` },
  ];
  const ordered = [...sizes].sort((a, b) => (SIZE_SPAN[a] ?? 12) - (SIZE_SPAN[b] ?? 12));
  const resizable = zone === "main" && ordered.length > 1;
  const onKey = (event: KeyboardEvent) => {
    const keys: Record<string, -1 | 1 | "min" | "max"> = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1, Home: "min", End: "max" };
    const direction = keys[event.key];
    if (direction === undefined) return;
    event.preventDefault();
    edit.resizeKey(widget, direction);
  };
  return (
    <div className="tv2-edit-chrome">
      <div className="tv2-edit-bar" role="group" aria-label={`Arrange ${label}`}>
        <span className="tv2-edit-grip" data-grip="" aria-hidden="true" onPointerDown={(event) => { edit.startDrag(widget, event); }}>
          <GripVertical className="size-4" />
        </span>
        {buttons.map(({ step, icon: Icon, name }) => (
          <button key={step} type="button" className="tv2-edit-btn" data-step={step} aria-label={`Move ${label} ${name} in preview`} disabled={!edit.can(widget, step)} onClick={() => { edit.step(widget, step); }}>
            <Icon className="size-4" aria-hidden="true" />
          </button>
        ))}
        <button type="button" className="tv2-edit-btn" aria-label={`Remove ${label} from preview`} onClick={() => { edit.remove(widget); }}>
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>
      {resizable ? (
        <div
          className="tv2-edit-resize"
          role="slider"
          tabIndex={0}
          aria-label={`Resize ${label}`}
          aria-orientation="horizontal"
          aria-valuemin={0}
          aria-valuemax={ordered.length - 1}
          aria-valuenow={Math.max(0, ordered.indexOf(size))}
          aria-valuetext={SIZE_LABEL[size] ?? size}
          onPointerDown={(event) => { edit.startResize(widget, event); }}
          onKeyDown={onKey}
        />
      ) : null}
    </div>
  );
}

/** What an empty zone shows while the preview is being edited, so a card can still be dropped there. */
export function EmptyZone({ zone }: { zone: Zone }) {
  return <div className="tv2-edit-empty">{ZONE_LABEL[zone]} is empty. Drop a widget here.</div>;
}
