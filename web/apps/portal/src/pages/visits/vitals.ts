/**
 * The vitals a visit can record, shared by the classic visit page and the new look: the kinds with their labels and
 * units, how a typed value is read, and how recorded readings are shown. Readings are append-only: a later one is a new
 * row, and a correction names the row it replaces in `supersedes_id`.
 */
import type { Observation, ObservationKind } from "@aarogyam/api-client";

export const OBSERVATION_KINDS: readonly { value: ObservationKind; label: string; unit: string }[] = [
  { value: "bp_systolic", label: "BP systolic", unit: "mmHg" },
  { value: "bp_diastolic", label: "BP diastolic", unit: "mmHg" },
  { value: "pulse", label: "Pulse", unit: "/min" },
  { value: "temperature", label: "Temperature", unit: "Cel" },
  { value: "spo2", label: "SpO2", unit: "%" },
  { value: "weight", label: "Weight", unit: "kg" },
  { value: "height", label: "Height", unit: "cm" },
  { value: "blood_sugar", label: "Blood sugar", unit: "mg/dL" },
];

export const kindLabel = (kind: string): string => OBSERVATION_KINDS.find((k) => k.value === kind)?.label ?? kind;

/** A typed value as a number; undefined when it is blank or not a number. The server checks the plausible range. */
export function parseValue(text: string): number | undefined {
  if (text.trim() === "") return undefined;
  const numeric = Number(text);
  return Number.isFinite(numeric) ? numeric : undefined;
}

const SHORT: Partial<Record<ObservationKind, string>> = { temperature: "Temp", blood_sugar: "Sugar" };
const UNIT_SUFFIX: Record<string, string> = { Cel: "°C", "[degF]": "°F", "%": "%", "/min": "" };

/** A reading's value with its unit: `36.8°C`, `98%`, `70 kg`; a pulse is a bare number. */
export function readingText(o: Pick<Observation, "value" | "unit">): string {
  const suffix = UNIT_SUFFIX[o.unit];
  return suffix === undefined ? `${String(o.value)} ${o.unit}` : `${String(o.value)}${suffix}`;
}

/** The readings that still stand: not marked entered in error, and not replaced by a correction. */
export function currentReadings(observations: readonly Observation[]): Observation[] {
  const replaced = new Set<string>();
  for (const o of observations) {
    if (o.supersedes_id != null) replaced.add(o.supersedes_id);
  }
  return observations.filter((o) => o.status !== "entered_in_error" && !replaced.has(o.id));
}

export interface Vital {
  id: string;
  /** `BP 120/80`, `Pulse 72`, `Temp 36.8°C`. */
  text: string;
  recordedAt: string;
}

/** What to show for a visit, oldest first. A systolic and a diastolic taken together read as one `BP 120/80`. */
export function vitalsOf(observations: readonly Observation[]): Vital[] {
  const live = currentReadings(observations).sort((a, b) => a.recorded_at.localeCompare(b.recorded_at));
  const paired = new Set<string>();
  const vitals: Vital[] = [];
  for (const o of live) {
    if (paired.has(o.id)) continue;
    const diastolic = o.kind === "bp_systolic" ? live.find((d) => d.kind === "bp_diastolic" && d.recorded_at === o.recorded_at && !paired.has(d.id)) : undefined;
    if (diastolic !== undefined) {
      paired.add(diastolic.id);
      vitals.push({ id: o.id, text: `BP ${String(o.value)}/${String(diastolic.value)}`, recordedAt: o.recorded_at });
    } else {
      vitals.push({ id: o.id, text: `${SHORT[o.kind] ?? kindLabel(o.kind)} ${readingText(o)}`, recordedAt: o.recorded_at });
    }
  }
  return vitals;
}
