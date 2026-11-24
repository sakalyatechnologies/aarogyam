// What native hands `present(mouth, options)` beyond the mouth: each option is checked here and a bad one
// is ignored, so an old or odd app never breaks the screen. The page makes no API calls; native fetches
// (see bridge.tsx for which API feeds which option) and saves what the page posts back.
import { dentalChart, imagePin, presentDiscussionList, type DentalChart, type PresentDiscussion } from "@aarogyam/api-client";

import type { XrayPin } from "@aarogyam/app-kit/present/xray-pins";

/** One X-ray native already fetched: `url` is its signed image link (never logged). */
export interface XrayInput {
  id: string;
  url: string;
  taken_at?: string | undefined;
  kind?: string | undefined;
  pins?: XrayPin[] | undefined;
}

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null;

/** JSON object or text, as `present` takes it. */
function asJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed;
  } catch {
    return undefined;
  }
}

/** The X-rays that parse, in the given order; undefined when the option is absent or not a list. */
export function asXrays(value: unknown): XrayInput[] | undefined {
  const v = asJson(value);
  if (!Array.isArray(v)) return undefined;
  const out: XrayInput[] = [];
  for (const r of v) {
    if (!isRecord(r)) continue;
    if (typeof r["id"] !== "string" || r["id"] === "" || typeof r["url"] !== "string" || r["url"] === "") continue;
    const pins = Array.isArray(r["pins"]) ? r["pins"].flatMap((p) => { const x = imagePin.safeParse(p); return x.success ? [x.data] : []; }) : undefined;
    out.push({
      id: r["id"],
      url: r["url"],
      taken_at: typeof r["taken_at"] === "string" ? r["taken_at"] : undefined,
      kind: typeof r["kind"] === "string" ? r["kind"] : undefined,
      pins,
    });
  }
  return out;
}

export function asChart(value: unknown): DentalChart | undefined {
  if (value === undefined || value === null) return undefined;
  const parsed = dentalChart.safeParse(asJson(value));
  return parsed.success ? parsed.data : undefined;
}

export function asDiscussions(value: unknown): PresentDiscussion[] | undefined {
  if (value === undefined || value === null) return undefined;
  const v = asJson(value);
  const parsed = presentDiscussionList.safeParse(Array.isArray(v) ? { discussions: v } : v);
  return parsed.success ? parsed.data.discussions : undefined;
}
