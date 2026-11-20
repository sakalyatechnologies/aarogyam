// Fake tooth details (section 1.13 of the visit story v2 design): a tooth's condition merged on
// each change, a permanent tooth's eruption, and the mouth snapshot. The server builds the
// snapshot; the fake serves the golden Aarav fixture so screens have real data to render.

import fixture from "../../../../../specialties/dental/fixtures/mouth-aarav.json" with { type: "json" };
import type * as C from "../contract.js";
import { mouthSnapshot } from "../schemas.js";

export interface FakeToothCondition {
  id: string;
  clinic_id: string;
  patient_id: string;
  tooth: number;
  infection?: string | undefined;
  bleeding?: boolean | undefined;
  pocket_mm?: number | undefined;
  mobility?: number | undefined;
  status: "current" | "superseded" | "entered_in_error";
  recorded_by: string;
  recorded_at: string;
}

export interface FakeToothEruption {
  id: string;
  clinic_id: string;
  patient_id: string;
  tooth: number;
  eruption: string;
  angulation?: string;
  status: "current" | "superseded" | "entered_in_error";
  recorded_by: string;
  recorded_at: string;
}

export const INFECTIONS = ["infection", "abscess"];
export const ERUPTIONS = ["erupted", "partial", "impacted", "unerupted"];
export const ANGULATIONS = ["vertical", "mesioangular", "distoangular", "horizontal"];

/** Merges a change onto the current condition: an omitted field keeps its value, `null` clears it. Returns a problem or the merged fields. */
export function mergeCondition(
  current: FakeToothCondition | undefined,
  input: C.NewToothCondition,
): { field: string; problem: string } | Pick<FakeToothCondition, "infection" | "bleeding" | "pocket_mm" | "mobility"> {
  const pick = <T>(given: T | null | undefined, kept: T | undefined): T | undefined => (given === undefined ? kept : (given ?? undefined));
  const merged = {
    infection: pick(input.infection, current?.infection),
    bleeding: pick(input.bleeding, current?.bleeding),
    pocket_mm: pick(input.pocket_mm, current?.pocket_mm),
    mobility: pick(input.mobility, current?.mobility),
  };
  if (merged.infection !== undefined && !INFECTIONS.includes(merged.infection)) {
    return { field: "infection", problem: "infection must be infection or abscess" };
  }
  if (merged.pocket_mm !== undefined && (merged.pocket_mm < 1 || merged.pocket_mm > 15)) {
    return { field: "pocket_mm", problem: "pocket_mm must be 1 to 15" };
  }
  if (merged.mobility !== undefined && (merged.mobility < 0 || merged.mobility > 3)) {
    return { field: "mobility", problem: "mobility must be 0 to 3" };
  }
  if (Object.values(merged).every((v) => v === undefined)) {
    return { field: "condition", problem: "set at least one of infection, bleeding, pocket_mm or mobility" };
  }
  return merged;
}

export function wireCondition(c: FakeToothCondition): C.ToothCondition {
  return {
    id: c.id,
    tooth: c.tooth,
    ...(c.infection === undefined ? {} : { infection: c.infection }),
    ...(c.bleeding === undefined ? {} : { bleeding: c.bleeding }),
    ...(c.pocket_mm === undefined ? {} : { pocket_mm: c.pocket_mm }),
    ...(c.mobility === undefined ? {} : { mobility: c.mobility }),
    recorded_by: c.recorded_by,
    recorded_at: c.recorded_at,
  };
}

export function wireEruption(e: FakeToothEruption): C.ToothEruption {
  return {
    id: e.id,
    tooth: e.tooth,
    eruption: e.eruption,
    ...(e.angulation === undefined ? {} : { angulation: e.angulation }),
    recorded_by: e.recorded_by,
    recorded_at: e.recorded_at,
  };
}

/** The patient's current details, left out when none, as the server does. */
export function wireDetails(
  conditions: FakeToothCondition[] | undefined,
  eruptions: FakeToothEruption[] | undefined,
  clinicId: string,
  patientId: string,
): { conditions?: C.ToothCondition[]; eruptions?: C.ToothEruption[] } {
  const mine = <T extends { clinic_id: string; patient_id: string; status: string; tooth: number }>(rows: T[] | undefined) =>
    (rows ?? []).filter((r) => r.clinic_id === clinicId && r.patient_id === patientId && r.status === "current").sort((a, b) => a.tooth - b.tooth);
  const c = mine(conditions);
  const e = mine(eruptions);
  return { ...(c.length === 0 ? {} : { conditions: c.map(wireCondition) }), ...(e.length === 0 ? {} : { eruptions: e.map(wireEruption) }) };
}

/** The golden Aarav snapshot (`specialties/dental/fixtures/mouth-aarav.json`). */
export const FIXTURE_MOUTH: C.MouthSnapshot = mouthSnapshot.parse(fixture.snapshot);
