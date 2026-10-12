/**
 * Where a pointer is on the Studio's preview, as plain functions over boxes, so the drop rules need no layout engine to
 * test. Boxes are in screen space, which is what the pointer reports even though the preview is scaled down.
 */

import type { DropPlace, Zone } from "./layout-model.js";

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface ZoneBox {
  zone: Zone;
  box: Box;
}

export interface CellBox {
  key: string;
  zone: Zone;
  box: Box;
  /** A cell that takes a whole row, so a drop lands above or below it rather than beside it. */
  wide: boolean;
}

/** How far outside a zone a pointer still counts as in it, so the gaps between cards are not dead. */
const SLACK = 16;

const inside = (box: Box, x: number, y: number, slack = 0) => x >= box.left - slack && x <= box.right + slack && y >= box.top - slack && y <= box.bottom + slack;
const gap = (box: Box, x: number, y: number) => Math.hypot(Math.max(box.left - x, 0, x - box.right), Math.max(box.top - y, 0, y - box.bottom));

/** The zone under the pointer: an exact hit first, then the nearest one within the slack. `undefined` is off the board. */
export function zoneAt(zones: readonly ZoneBox[], x: number, y: number): Zone | undefined {
  const exact = zones.find((z) => inside(z.box, x, y));
  if (exact !== undefined) return exact.zone;
  let best: ZoneBox | undefined;
  for (const z of zones) if (inside(z.box, x, y, SLACK) && (best === undefined || gap(z.box, x, y) < gap(best.box, x, y))) best = z;
  return best?.zone;
}

/** The drop place under the pointer: its zone and the card it falls before or after. `undefined` is off the board. */
export function locate(x: number, y: number, zones: readonly ZoneBox[], cells: readonly CellBox[], dragging: string): DropPlace | undefined {
  const zone = zoneAt(zones, x, y);
  if (zone === undefined) return undefined;
  const here = cells.filter((cell) => cell.zone === zone && cell.key !== dragging);
  let near: CellBox | undefined;
  for (const cell of here) if (near === undefined || gap(cell.box, x, y) < gap(near.box, x, y)) near = cell;
  if (near === undefined) return { zone };
  const midX = (near.box.left + near.box.right) / 2;
  const midY = (near.box.top + near.box.bottom) / 2;
  const sameRow = y >= near.box.top && y <= near.box.bottom;
  const before = zone === "main" && !near.wide && sameRow ? x < midX : y < midY;
  return { zone, anchor: near.key, side: before ? "before" : "after" };
}
