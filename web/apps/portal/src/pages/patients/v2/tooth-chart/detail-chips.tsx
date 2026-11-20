/**
 * The tooth panel's optional one-tap details (design §1.13): a Condition row on every tooth (infection, bleeding, pocket,
 * mobility), the wisdom tooth's position and angle on the 8s (other permanent teeth behind "More"), and "Infection resolved" after a treatment is done. Each tap
 * saves at once (one PUT, merged on the server); skipping them costs no taps.
 */
import type { ChartEntry, NewToothCondition, PatientId, Procedure, ToothCondition, ToothEruption } from "@aarogyam/api-client";
import { formatDate } from "@aarogyam/app-kit";
import { DETAIL_CHIPS, DETAIL_VALUES } from "@aarogyam/app-kit/mouth-art";
import { useToast } from "@sakalya/ui";
import { useState } from "react";

import { useSetToothCondition, useSetToothEruption } from "../../../../queries.js";

const WORK = new Set(["filled", "crown", "root_canal", "implant", "bridge", "missing"]);
const POCKETS = [4, 5, 6, 7] as const;
const GRADES = [1, 2, 3] as const;
const isToday = (iso: string | null | undefined, now: Date) => iso != null && new Date(iso).toDateString() === now.toDateString();

/** A treatment was done on the tooth today (a done procedure, or finished work charted today): DT3. */
export function treatedToday(tooth: number, entries: readonly ChartEntry[], procedures: readonly Procedure[], now = new Date()): boolean {
  return (
    entries.some((e) => e.tooth === tooth && WORK.has(e.finding) && !e.in_progress && isToday(e.effective_at, now)) ||
    procedures.some((p) => p.tooth === tooth && p.status === "done" && isToday(p.performed_at ?? p.created_at, now))
  );
}

interface Props {
  patientId: PatientId;
  tooth: number;
  entries: readonly ChartEntry[];
  procedures: readonly Procedure[];
  condition: ToothCondition | undefined;
  eruption: ToothEruption | undefined;
}

export function DetailChips({ patientId, tooth, entries, procedures, condition, eruption }: Props) {
  const setCondition = useSetToothCondition(patientId);
  const setEruption = useSetToothEruption(patientId);
  const toast = useToast();
  const failed = () => {
    toast.show({ title: "Couldn't save that detail. Please try again.", tone: "danger" });
  };
  const busy = setCondition.isPending || setEruption.isPending;
  const missing = entries.some((e) => e.tooth === tooth && e.finding === "missing");
  const put = (input: NewToothCondition) => {
    setCondition.mutate({ tooth, input }, { onError: failed });
  };
  const permanent = Math.floor(tooth / 10) <= 4;
  const [more, setMore] = useState(false);
  // position and angle: on the 8s by default; any other permanent tooth through "More" (§1.13), open when already recorded
  const wisdom = permanent && (tooth % 10 === 8 || more || eruption !== undefined);
  const angled = eruption !== undefined && eruption.eruption !== "erupted";
  const resolved = condition?.infection !== undefined && treatedToday(tooth, entries, procedures);
  const chip = (label: string, pressed: boolean, onClick: () => void, extra?: string) => (
    <button key={label} type="button" className="tc-chip" aria-pressed={pressed} disabled={busy} onClick={onClick} {...(extra === undefined ? {} : { "aria-label": extra })}>
      {label}
    </button>
  );
  return (
    <div className="tc-details">
      {missing ? null : (
        <div className="tc-chip-row" role="group" aria-label="Condition">
          <span className="tc-chip-label">Condition</span>
          {DETAIL_VALUES.infection.map((v) => chip(DETAIL_CHIPS.infection[v], condition?.infection === v, () => { put({ infection: condition?.infection === v ? null : v }); }))}
          {chip("Bleeding", condition?.bleeding === true, () => { put({ bleeding: condition?.bleeding === true ? null : true }); })}
          {POCKETS.map((mm) => {
            const on = mm === 7 ? (condition?.pocket_mm ?? 0) >= 7 : condition?.pocket_mm === mm;
            return chip(mm === 7 ? "7+" : String(mm), on, () => { put({ pocket_mm: on ? null : mm }); }, `Pocket ${mm === 7 ? "7 or more" : String(mm)} mm`);
          })}
          {GRADES.map((g) => chip(`Mobility ${String(g)}`, condition?.mobility === g, () => { put({ mobility: condition?.mobility === g ? null : g }); }))}
          {condition === undefined ? null : <span className="tc-chip-date">{`Recorded ${formatDate(condition.recorded_at)}`}</span>}
        </div>
      )}
      {resolved ? (
        <div className="tc-chip-row">
          <button type="button" className="tc-chip tc-chip-resolve" disabled={busy} onClick={() => { put({ infection: null }); }}>
            Infection resolved
          </button>
        </div>
      ) : null}
      {permanent && !wisdom ? (
        <div className="tc-chip-row">
          <button type="button" className="tc-chip tc-chip-more" aria-expanded={false} onClick={() => { setMore(true); }}>
            More
          </button>
        </div>
      ) : null}
      {wisdom ? (
        <div className="tc-chip-row" role="group" aria-label={tooth % 10 === 8 ? "Wisdom tooth position" : "Tooth position"}>
          <span className="tc-chip-label">Position</span>
          {DETAIL_VALUES.eruption.map((v) => chip(DETAIL_CHIPS.eruption[v], eruption?.eruption === v, () => { setEruption.mutate({ tooth, input: { eruption: v } }, { onError: failed }); }))}
          {eruption === undefined ? null : <span className="tc-chip-date">{`Recorded ${formatDate(eruption.recorded_at)}`}</span>}
        </div>
      ) : null}
      {wisdom && angled ? (
        <div className="tc-chip-row" role="group" aria-label={tooth % 10 === 8 ? "Wisdom tooth angle" : "Tooth angle"}>
          <span className="tc-chip-label">Angle</span>
          {DETAIL_VALUES.angulation.map((v) => chip(DETAIL_CHIPS.angulation[v], eruption.angulation === v, () => { setEruption.mutate({ tooth, input: { eruption: eruption.eruption, angulation: v } }, { onError: failed }); }))}
        </div>
      ) : null}
    </div>
  );
}
