import { z } from "zod";

/** What `pnpm guides:render` publishes under /guides (scripts/render-guides.mjs). */

export type GuideRole = "getting-started" | "front-desk" | "doctor" | "billing" | "owner";

/** Where a step points, as fractions (0 to 1) of the still. */
export interface GuideBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PublishedStep {
  title: string;
  narration: string;
  still: string;
  audio?: string | undefined;
  /** Length of the narration, in seconds. */
  seconds: number;
  box?: GuideBox | undefined;
}

export interface PublishedGuide {
  id: string;
  title: string;
  role: GuideRole;
  summary: string;
  order: number;
  /** About how long it plays, in seconds. */
  seconds: number;
  steps: PublishedStep[];
}

export interface GuideIndexEntry {
  id: string;
  title: string;
  role: GuideRole;
  summary: string;
  order: number;
  seconds: number;
  steps: number;
  still: string;
}

export interface GuideIndex {
  guides: GuideIndexEntry[];
}

export const GUIDES_BASE = "/guides";

/** Group order and names on the Guides page. "Getting started" leads, with its first card as "Start here". */
export const ROLE_GROUPS: readonly { role: GuideRole; label: string }[] = [
  { role: "getting-started", label: "Getting started" },
  { role: "front-desk", label: "Front desk" },
  { role: "doctor", label: "Doctor" },
  { role: "billing", label: "Billing" },
  { role: "owner", label: "Clinic owner" },
];

/** "2 min" for a length in seconds, rounded to the nearest half minute below 3 minutes. */
export function lengthLabel(seconds: number): string {
  if (seconds < 60) return `${String(Math.max(1, Math.round(seconds)))} sec`;
  const minutes = seconds / 60;
  const rounded = Math.round(minutes * 2) / 2;
  return `${String(rounded)} min`;
}

const roleSchema = z.enum(["getting-started", "front-desk", "doctor", "billing", "owner"]);
const stepSchema = z.object({
  title: z.string(),
  narration: z.string(),
  still: z.string(),
  audio: z.string().optional(),
  seconds: z.number(),
  box: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }).optional(),
});
const guideSchema = z.object({ id: z.string(), title: z.string(), role: roleSchema, summary: z.string(), order: z.number(), seconds: z.number(), steps: z.array(stepSchema) });
const indexSchema = z.object({
  guides: z.array(z.object({ id: z.string(), title: z.string(), role: roleSchema, summary: z.string(), order: z.number(), seconds: z.number(), steps: z.number(), still: z.string() })),
});

/** The parsed guide, or undefined when the file is not a guide. */
export function parsePublishedGuide(data: unknown): PublishedGuide | undefined {
  const parsed = guideSchema.safeParse(data);
  return parsed.success ? (parsed.data) : undefined;
}

export function parseGuideIndex(data: unknown): GuideIndex | undefined {
  const parsed = indexSchema.safeParse(data);
  return parsed.success ? parsed.data : undefined;
}
