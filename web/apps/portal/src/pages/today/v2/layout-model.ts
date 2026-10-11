/**
 * The Today board's layout, as plain functions: what the catalogue says about a widget, which items a member may see,
 * and the edits the Studio makes. No React here, so the rules are easy to test. The catalogue comes from the API (one
 * source for the keys, sizes, zones, permissions and options); the registry in `registry.tsx` supplies how each is drawn.
 */

import { PERMISSIONS, type DashboardCatalogue, type DashboardLayout, type DashboardLayoutView, type Permission } from "@aarogyam/api-client";

type DashboardLayoutItem = DashboardLayout["items"][number];

export type WidgetSpec = DashboardCatalogue["widgets"][number];
export type LayoutOpts = Record<string, unknown>;
export type OptionSpec = WidgetSpec["options"][number];

export type Zone = "top" | "main" | "rail";
export const ZONES: readonly Zone[] = ["top", "main", "rail"];
export const ZONE_LABEL: Readonly<Record<Zone, string>> = { top: "Top strip", main: "Main area", rail: "Side rail" };
export const SIZES = ["S", "M", "L", "full"] as const;
export const SIZE_LABEL: Readonly<Record<string, string>> = { S: "Small", M: "Medium", L: "Large", full: "Full width" };
/** Columns of the 12-column main grid. */
export const SIZE_SPAN: Readonly<Record<string, number>> = { S: 4, M: 6, L: 8, full: 12 };

export function specOf(catalogue: DashboardCatalogue, key: string): WidgetSpec | undefined {
  return catalogue.widgets.find((widget) => widget.key === key);
}

export function isZone(zone: string): zone is Zone {
  return zone === "top" || zone === "main" || zone === "rail";
}

/** Whether the member holds the permission a widget (or metric) asks for. Nothing asked means anyone. */
export function allowed(requires: string | null | undefined, can: (permission: Permission) => boolean): boolean {
  if (requires == null) return true;
  // A permission this portal does not know (the server added one) is not held.
  const known = PERMISSIONS.find((permission) => permission === requires);
  return known !== undefined && can(known);
}

/** An item's options with the catalogue's defaults filled in for anything left out. */
export function optsOf(spec: WidgetSpec | undefined, item: DashboardLayoutItem): LayoutOpts {
  const out: LayoutOpts = {};
  for (const option of spec?.options ?? []) out[option.key] = option.default;
  return { ...out, ...(item.opts ?? {}) };
}

export function defaultOpts(spec: WidgetSpec): LayoutOpts {
  return Object.fromEntries(spec.options.map((option) => [option.key, option.default]));
}

export interface ShownItem {
  item: DashboardLayoutItem;
  spec: WidgetSpec;
  zone: Zone;
  /** Position in the layout's own list, which is what the Studio edits. */
  index: number;
}

/** Widgets that show money: they need `finance.view` whatever else the catalogue asks for. */
export const MONEY_WIDGETS: ReadonlySet<string> = new Set(["collections", "revenue_mix", "pending_payments"]);

/** The items a member sees: known to the catalogue and allowed by `can()`. Order is the layout's. */
export function shownItems(layout: DashboardLayout, catalogue: DashboardCatalogue, can: (permission: Permission) => boolean, known: (key: string) => boolean): ShownItem[] {
  const out: ShownItem[] = [];
  layout.items.forEach((item, index) => {
    const spec = specOf(catalogue, item.key);
    if (spec === undefined || !known(item.key) || !isZone(item.zone) || !allowed(spec.requires, can)) return;
    if (MONEY_WIDGETS.has(item.key) && !can("finance.view")) return;
    out.push({ item, spec, zone: item.zone, index });
  });
  return out;
}

/** Items of one zone, in layout order. */
export function inZone(items: readonly ShownItem[], zone: Zone): ShownItem[] {
  return items.filter((entry) => entry.zone === zone);
}

// Edits ----------------------------------------------------------------------------------------

export function templateLayout(catalogue: Pick<DashboardCatalogue, "templates">, key: string): DashboardLayout | undefined {
  const found = catalogue.templates.find((template) => template.key === key)?.layout;
  return found === undefined ? undefined : shownLayout(found);
}

/** What the Studio no longer offers. The API still accepts both, so a saved layout may hold one. */
export const RETIRED_CARD: Readonly<Record<string, string>> = { flat: "soft" };
export const RETIRED_TEMPLATE: Readonly<Record<string, string>> = { focus: "medsync" };

/** The layout as the Studio shows it: a saved `flat` card style reads as `soft`, and a saved `focus` template as `medsync`. */
export function shownLayout(layout: DashboardLayout): DashboardLayout {
  const card = RETIRED_CARD[layout.card] ?? layout.card;
  const tpl = RETIRED_TEMPLATE[layout.tpl] ?? layout.tpl;
  return card === layout.card && tpl === layout.tpl ? layout : { ...layout, card, tpl };
}

/** The templates and card styles the Studio offers: the catalogue's, without the retired ones. */
export const offeredTemplates = (catalogue: Pick<DashboardCatalogue, "templates">) => catalogue.templates.filter((template) => RETIRED_TEMPLATE[template.key] === undefined);
export const offeredCards = (catalogue: Pick<DashboardCatalogue, "cards">) => catalogue.cards.filter((card) => RETIRED_CARD[card] === undefined);

/** The first size a zone allows for a widget, preferring `wanted`. In the rail the size is ignored but must stay valid. */
export function fitSize(spec: WidgetSpec, wanted: string): string {
  return spec.sizes.includes(wanted) ? wanted : (spec.sizes.includes(spec.default_size) ? spec.default_size : (spec.sizes[0] ?? "M"));
}

export function addWidget(layout: DashboardLayout, spec: WidgetSpec): DashboardLayout {
  if (layout.items.some((item) => item.key === spec.key)) return layout;
  return { ...layout, items: [...layout.items, { key: spec.key, zone: spec.default_zone, size: spec.default_size, opts: defaultOpts(spec) }] };
}

export function removeAt(layout: DashboardLayout, index: number): DashboardLayout {
  return { ...layout, items: layout.items.filter((_, at) => at !== index) };
}

export function patchItem(layout: DashboardLayout, index: number, patch: Partial<DashboardLayoutItem>): DashboardLayout {
  return { ...layout, items: layout.items.map((item, at) => (at === index ? { ...item, ...patch } : item)) };
}

export function setOpt(layout: DashboardLayout, index: number, key: string, value: unknown): DashboardLayout {
  const item = layout.items[index];
  return item === undefined ? layout : patchItem(layout, index, { opts: { ...(item.opts ?? {}), [key]: value } });
}

/** Moves a widget to another zone, keeping its size valid. */
export function setZone(layout: DashboardLayout, index: number, zone: Zone, catalogue: DashboardCatalogue): DashboardLayout {
  const item = layout.items[index];
  const spec = item === undefined ? undefined : specOf(catalogue, item.key);
  if (item === undefined || spec === undefined || !spec.zones.includes(zone)) return layout;
  return patchItem(layout, index, { zone, size: fitSize(spec, item.size) });
}

/**
 * Moves an item one step within its zone (`-1` up, `1` down) by swapping it with its neighbour in that zone. Items of
 * other zones keep their places, so the move is seen only where it happens.
 */
export function moveInZone(layout: DashboardLayout, index: number, direction: -1 | 1): DashboardLayout {
  const item = layout.items[index];
  if (item === undefined) return layout;
  let target = index + direction;
  while (target >= 0 && target < layout.items.length && layout.items[target]?.zone !== item.zone) target += direction;
  if (target < 0 || target >= layout.items.length) return layout;
  const items = [...layout.items];
  const other = items[target];
  if (other === undefined) return layout;
  items[target] = item;
  items[index] = other;
  return { ...layout, items };
}

/** Drops `from` just before `to`, taking `to`'s zone: the drag-and-drop move. */
export function dropOn(layout: DashboardLayout, from: number, to: number, catalogue: DashboardCatalogue): DashboardLayout {
  const moving = layout.items[from];
  const anchor = layout.items[to];
  if (moving === undefined || anchor === undefined || from === to) return layout;
  const spec = specOf(catalogue, moving.key);
  if (spec === undefined || !isZone(anchor.zone) || !spec.zones.includes(anchor.zone)) return layout;
  const rest = layout.items.filter((_, at) => at !== from);
  const at = rest.indexOf(anchor);
  const placed: DashboardLayoutItem = { ...moving, zone: anchor.zone, size: anchor.zone === moving.zone ? moving.size : fitSize(spec, moving.size) };
  return { ...layout, items: [...rest.slice(0, at), placed, ...rest.slice(at)] };
}

/** Where a drop lands: a zone, and a place in it (before or after a widget, or at the zone's end when `anchor` is absent). */
export interface DropPlace {
  zone: Zone;
  anchor?: string | undefined;
  side?: "before" | "after" | undefined;
}

/** Whether the catalogue lets this widget sit in this zone. */
export function zoneAllowed(catalogue: DashboardCatalogue, key: string, zone: Zone): boolean {
  return specOf(catalogue, key)?.zones.includes(zone) === true;
}

/**
 * Drops the widget `key` at `place`. A zone the widget may not sit in, or a place that changes nothing, hands the very
 * same layout back, so the edit snaps back. Moving into another zone keeps the size valid for that widget.
 */
export function dropInZone(layout: DashboardLayout, key: string, place: DropPlace, catalogue: DashboardCatalogue): DashboardLayout {
  const moving = layout.items.find((item) => item.key === key);
  const spec = specOf(catalogue, key);
  if (moving === undefined || spec === undefined || !spec.zones.includes(place.zone) || place.anchor === key) return layout;
  const rest = layout.items.filter((item) => item.key !== key);
  const anchorAt = place.anchor === undefined ? -1 : rest.findIndex((item) => item.key === place.anchor);
  let at: number;
  if (anchorAt >= 0) at = place.side === "after" ? anchorAt + 1 : anchorAt;
  else {
    at = rest.length;
    for (let i = rest.length - 1; i >= 0; i -= 1) {
      if (rest[i]?.zone === place.zone) {
        at = i + 1;
        break;
      }
    }
  }
  const placed: DashboardLayoutItem = { ...moving, zone: place.zone, size: place.zone === moving.zone ? moving.size : fitSize(spec, moving.size) };
  const items = [...rest.slice(0, at), placed, ...rest.slice(at)];
  const same = items.every((item, i) => {
    const was = layout.items.at(i);
    return was !== undefined && item.key === was.key && item.zone === was.zone && item.size === was.size;
  });
  return same ? layout : { ...layout, items };
}

export type Step = "up" | "down" | "left" | "right";

/** The zone a left or right step goes to: the main area and the rail swap sides with the rail's side; the top strip has none. */
export function sideStepZone(zone: Zone, direction: "left" | "right", railSide: string): Zone | undefined {
  const railDirection = railSide === "left" ? "left" : "right";
  if (zone === "main" && direction === railDirection) return "rail";
  if (zone === "rail" && direction !== railDirection) return "main";
  return undefined;
}

/** Whether a keyboard step is allowed: not at an edge of its zone, and never into a zone the widget may not use. */
export function canStep(layout: DashboardLayout, key: string, step: Step, catalogue: DashboardCatalogue): boolean {
  const index = layout.items.findIndex((item) => item.key === key);
  const item = layout.items[index];
  if (item === undefined || !isZone(item.zone)) return false;
  if (step === "up" || step === "down") return moveInZone(layout, index, step === "up" ? -1 : 1) !== layout;
  const zone = sideStepZone(item.zone, step, layout.rail.side);
  return zone !== undefined && zoneAllowed(catalogue, key, zone);
}

/** Applies a keyboard step; the same layout comes back when the step is not allowed. */
export function stepWidget(layout: DashboardLayout, key: string, step: Step, catalogue: DashboardCatalogue): DashboardLayout {
  if (!canStep(layout, key, step, catalogue)) return layout;
  const index = layout.items.findIndex((item) => item.key === key);
  const item = layout.items[index];
  if (item === undefined || !isZone(item.zone)) return layout;
  if (step === "up" || step === "down") return moveInZone(layout, index, step === "up" ? -1 : 1);
  const zone = sideStepZone(item.zone, step, layout.rail.side);
  return zone === undefined ? layout : dropInZone(layout, key, { zone }, catalogue);
}

/** The widget's allowed sizes, narrowest first. */
export function sizesOf(spec: WidgetSpec): string[] {
  return [...spec.sizes].sort((a, b) => (SIZE_SPAN[a] ?? 12) - (SIZE_SPAN[b] ?? 12));
}

/** The next allowed size up (`1`) or down (`-1`), staying put at the end. */
export function stepSize(spec: WidgetSpec, size: string, direction: -1 | 1): string {
  const sizes = sizesOf(spec);
  const at = sizes.indexOf(size);
  return sizes[Math.min(sizes.length - 1, Math.max(0, (at < 0 ? 0 : at) + direction))] ?? size;
}

/** The allowed size whose width is closest to `span` columns of the 12-column grid. */
export function nearestSize(spec: WidgetSpec, span: number): string {
  const sizes = sizesOf(spec);
  let best = sizes[0] ?? spec.default_size;
  for (const size of sizes) if (Math.abs((SIZE_SPAN[size] ?? 12) - span) < Math.abs((SIZE_SPAN[best] ?? 12) - span)) best = size;
  return best;
}

/** Whether two layouts say the same thing (key order and option defaults aside). */
export function sameLayout(a: DashboardLayout, b: DashboardLayout): boolean {
  return JSON.stringify(normal(a)) === JSON.stringify(normal(b));
}

function normal(layout: DashboardLayout) {
  return {
    tpl: layout.tpl,
    density: layout.density,
    card: layout.card,
    rail: layout.rail,
    items: layout.items.map((item) => ({ key: item.key, zone: item.zone, size: item.size, opts: sortKeys(item.opts ?? {}) })),
  };
}

function sortKeys(opts: LayoutOpts): LayoutOpts {
  return Object.fromEntries(Object.entries(opts).sort(([a], [b]) => a.localeCompare(b)));
}


// The portal's own take on the templates ---------------------------------------------------------

type Items = DashboardLayout["items"];

function placed(catalogue: DashboardCatalogue, key: string, zone: Zone, size: string, opts: LayoutOpts = {}): Items[number] {
  const spec = specOf(catalogue, key);
  return { key, zone, size, opts: { ...(spec === undefined ? {} : defaultOpts(spec)), ...opts } };
}

/** The key numbers of the MedSync top strip, in the order the founder chose. */
export const MEDSYNC_METRICS = ["appointments", "chairs_busy", "waiting", "collected", "lab_due"] as const;

/**
 * A template as the New look draws it. The side column (calendar, queue and completed) always runs the full height of
 * the page, on the left. The server's templates were laid out before that, so the portal puts them right here and the
 * API stays as it is: MedSync becomes the key-number strip, the next-up hero and the appointments table beside the
 * calendar column; the others keep their widgets and only gain the left column, with the queue and calendar in it.
 */
export function restyleTemplate(catalogue: DashboardCatalogue, key: string, layout: DashboardLayout): DashboardLayout {
  if (key === "medsync") {
    return {
      ...layout,
      rail: { side: "left", width: "medium" },
      items: [
        placed(catalogue, "kpis", "top", "full", { metrics: [...MEDSYNC_METRICS] }),
        placed(catalogue, "nextup", "main", "full", { count: 3 }),
        placed(catalogue, "appointments", "main", "full", { view: "table" }),
        placed(catalogue, "calendar", "rail", "S"),
        placed(catalogue, "queue", "rail", "M"),
      ],
    };
  }
  const calendar = layout.items.find((item) => item.key === "calendar") ?? placed(catalogue, "calendar", "rail", "S");
  const queue = layout.items.find((item) => item.key === "queue");
  const rest = layout.items.filter((item) => item.key !== "calendar" && item.key !== "queue");
  const column = [calendar, ...(queue === undefined ? [] : [queue]), ...rest.filter((item) => item.zone === "rail")].map((item) => ({ ...item, zone: "rail" }));
  return { ...layout, rail: { ...layout.rail, side: "left" }, items: [...rest.filter((item) => item.zone !== "rail"), ...column] };
}

/**
 * The view as the New look shows it: every template restyled, and a layout that is still a server template untouched
 * becomes the restyled one. A layout somebody changed and saved is left exactly as it is.
 */
export function adoptTemplates(view: DashboardLayoutView): DashboardLayoutView {
  const server = view.catalogue;
  const templates = server.templates.map((template) => ({ ...template, layout: restyleTemplate(server, template.key, template.layout) }));
  const stock = server.templates.find((template) => template.key === view.layout.tpl);
  const untouched = stock !== undefined && sameLayout(stock.layout, view.layout);
  const layout = untouched ? (templates.find((template) => template.key === stock.key)?.layout ?? view.layout) : view.layout;
  return { ...view, layout, catalogue: { ...server, templates } };
}
