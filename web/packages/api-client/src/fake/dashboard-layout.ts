/**
 * The fake API's dashboard layouts. The catalogue is the file the Rust tests keep equal to the
 * server's registry (`dashboard-catalogue.json`), and the checks below are driven by it: the
 * same rules as `aarogyam-domain/src/dashboard.rs`, so the fake refuses what the server refuses.
 */

import type * as C from "../contract.js";
import { dashboardCatalogue } from "../schemas.js";
import catalogueJson from "./dashboard-catalogue.json";

export const DASHBOARD_CATALOGUE: C.DashboardCatalogue = dashboardCatalogue.parse(catalogueJson);

const LAYOUT_KEYS = new Set(["v", "tpl", "density", "card", "rail", "items"]);
const ITEM_KEYS = new Set(["key", "zone", "size", "opts"]);

export type LayoutCheck = { ok: true; layout: C.DashboardLayout } | { ok: false; message: string };

const bad = (field: string, message: string): LayoutCheck => ({ ok: false, message: `${field}: ${message}` });

function checkOption(option: C.DashboardWidgetOption, value: unknown): string | null {
  switch (option.kind) {
    case "choice":
      return typeof value === "string" && (option.choices ?? []).includes(value) ? null : "not one of the allowed values";
    case "int_choice":
      return typeof value === "number" && (option.choices ?? []).includes(value) ? null : "not one of the allowed numbers";
    case "int_range":
      return typeof value === "number" && Number.isInteger(value) && value >= (option.min ?? 0) && value <= (option.max ?? 0)
        ? null
        : "a whole number outside the allowed range";
    case "bool":
      return typeof value === "boolean" ? null : "must be true or false";
    case "metrics": {
      if (!Array.isArray(value)) return "must be a list";
      if (value.length < (option.min ?? 0) || value.length > (option.max ?? 0)) return "wrong number of metrics";
      const known = new Set(DASHBOARD_CATALOGUE.metrics.map((m) => m.key));
      const seen = new Set<unknown>();
      for (const entry of value) {
        if (typeof entry !== "string" || !known.has(entry)) return "unknown metric";
        if (seen.has(entry)) return "a metric is listed twice";
        seen.add(entry);
      }
      return null;
    }
    default:
      return "unknown option kind";
  }
}

/** Checks a layout against the catalogue and returns it with every option filled in, or the first problem. */
export function validateLayout(input: C.DashboardLayout): LayoutCheck {
  const c = DASHBOARD_CATALOGUE;
  if (Object.keys(input).some((k) => !LAYOUT_KEYS.has(k))) return bad("body", "unknown field");
  if (input.v !== undefined && input.v !== c.version) return bad("v", "only version 2 is supported");
  if (!c.templates.some((t) => t.key === input.tpl)) return bad("tpl", "unknown template");
  if (!c.densities.includes(input.density)) return bad("density", "must be compact or cozy");
  if (!c.cards.includes(input.card)) return bad("card", "must be flat, soft or outline");
  if (!c.rail_sides.includes(input.rail.side)) return bad("rail.side", "must be left or right");
  if (!c.rail_widths.includes(input.rail.width)) return bad("rail.width", "must be narrow, medium or wide");
  if (input.items.length > c.widgets.length) return bad("items", "more items than there are widgets");
  const items: C.DashboardLayoutItem[] = [];
  for (const [index, item] of input.items.entries()) {
    const at = (what: string) => `items[${String(index)}].${what}`;
    if (Object.keys(item).some((k) => !ITEM_KEYS.has(k))) return bad(`items[${String(index)}]`, "unknown field");
    const widget = c.widgets.find((w) => w.key === item.key);
    if (widget === undefined) return bad(at("key"), "unknown widget");
    if (items.some((seen) => seen.key === item.key)) return bad(at("key"), "this widget is listed twice");
    if (!c.zones.includes(item.zone)) return bad(at("zone"), "must be top, main or rail");
    if (!widget.zones.includes(item.zone)) return bad(at("zone"), "this widget cannot go in that zone");
    if (!c.sizes.includes(item.size)) return bad(at("size"), "must be S, M, L or full");
    if (!widget.sizes.includes(item.size)) return bad(at("size"), "this widget does not come in that size");
    const given = item.opts ?? {};
    for (const name of Object.keys(given)) {
      if (!widget.options.some((o) => o.key === name)) return bad(at(`opts.${name}`), "this widget has no such option");
    }
    const opts: Record<string, unknown> = {};
    for (const option of widget.options) {
      const value = option.key in given ? given[option.key] : option.default;
      const problem = option.key in given ? checkOption(option, value) : null;
      if (problem !== null) return bad(at(`opts.${option.key}`), problem);
      opts[option.key] = value;
    }
    items.push({ key: item.key, zone: item.zone, size: item.size, opts });
  }
  return { ok: true, layout: { v: c.version, tpl: input.tpl, density: input.density, card: input.card, rail: { side: input.rail.side, width: input.rail.width }, items } };
}

/** The built-in default: the MedSync template. */
export function builtInLayout(): C.DashboardLayout {
  const medsync = DASHBOARD_CATALOGUE.templates.find((t) => t.key === "medsync");
  if (medsync === undefined) throw new Error("the catalogue has no medsync template");
  return structuredClone(medsync.layout);
}
