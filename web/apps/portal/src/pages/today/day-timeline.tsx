import { useLayoutEffect, useRef } from "react";

import type { Today } from "@aarogyam/api-client";
import { formatTime } from "@aarogyam/app-kit";

import { MkAvatar, StatusChip } from "../../components/mk/index.js";
import { APPOINTMENT_CHIP } from "../../lib/appointment-status.js";
import { clockLabel, gridHours, nowMinutes, packColumns, placementOf } from "../../lib/time-grid.js";

type TodayAppointment = Today["appointments"][number];

/** Height of the scroll area, fixed so the page never grows with a long day. */
export const TIMELINE_HEIGHT = 440;
/** Vertical scale: one hour is this many pixels. */
export const PX_PER_HOUR = 96;
const PX_PER_MIN = PX_PER_HOUR / 60;
const GUTTER = 58;
/** A visit shorter than this still takes this much room, so its name can be read and clicked. */
const MIN_EVENT_MIN = 30;


/** Where the schedule scrolls to so that `nowMin` sits in the middle of a viewport `viewport` tall. */
export function scrollTopForNow(nowMin: number, startHour: number, viewport: number, contentHeight: number): number {
  const target = (nowMin - startHour * 60) * PX_PER_MIN - viewport / 2;
  return Math.max(0, Math.min(target, Math.max(0, contentHeight - viewport)));
}

export interface DayTimelineProps {
  appointments: readonly TodayAppointment[];
  asOf: string;
  timeZone: string;
  /** The appointment tagged Next. */
  nextId: string | undefined;
  waitingMinutes: (appointment: TodayAppointment) => number;
  onOpen: (appointment: TodayAppointment) => void;
}

/**
 * The clinic's day as a scrollable time axis: 8 am to 9 pm, widened to fit every appointment, in a
 * fixed-height area that opens on the current time. Earlier and later visits are a scroll away.
 */
export function DayTimeline({ appointments, asOf, timeZone, nextId, waitingMinutes, onOpen }: DayTimelineProps) {
  const wrap = useRef<HTMLDivElement>(null);
  const placed = appointments.map((appointment) => ({ appointment, ...placementOf(appointment.starts_at, appointment.ends_at, timeZone) }));
  const { start, end } = gridHours(placed);
  const height = (end - start) * PX_PER_HOUR;
  const now = nowMinutes(asOf, timeZone).minutes;
  const nowVisible = now >= start * 60 && now <= end * 60;
  const nowTime = formatTime(asOf, timeZone);
  const packed = packColumns(
    placed.map((p) => ({ ...p, startMin: p.startMin, endMin: Math.max(p.endMin, p.startMin + MIN_EVENT_MIN) })),
  );

  const scrollToNow = () => {
    const el = wrap.current;
    if (el !== null) {
      el.scrollTop = scrollTopForNow(now, start, el.clientHeight || TIMELINE_HEIGHT, height);
    }
  };
  // Open on the current time when the schedule appears; later refreshes must not pull the view
  // away from where the person scrolled (the "Jump to now" button does that on request).
  useLayoutEffect(() => {
    scrollToNow();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- on mount only
  }, []);

  const hours = Array.from({ length: end - start + 1 }, (_, index) => start + index);
  return (
    <>
      <div className="mk-tl-bar">
        <button type="button" className="mk-link" onClick={scrollToNow} disabled={!nowVisible}>
          Jump to now
        </button>
      </div>
      <div className="mk-tlwrap" ref={wrap} role="region" aria-label="Today's schedule, scrollable" tabIndex={0} style={{ height: TIMELINE_HEIGHT }}>
        <ol className="mk-tl" style={{ height }} data-start-hour={start} data-end-hour={end}>
          {hours.map((hour) => (
            <li key={`h-${String(hour)}`} className="mk-tl-hour" aria-hidden="true" style={{ top: (hour - start) * PX_PER_HOUR }}>
              <span>{clockLabel(hour * 60)}</span>
            </li>
          ))}
          {packed.map(({ item, column, columns }) => {
            const a = item.appointment;
            const tag = a.id === nextId ? { label: "Next", tone: "brand" as const } : APPOINTMENT_CHIP[a.status];
            const minutes = Math.round((Date.parse(a.ends_at) - Date.parse(a.starts_at)) / 60_000);
            const state = a.status === "completed" ? "done" : a.status === "arrived" ? "wait" : "";
            return (
              <li
                key={a.id}
                className={`mk-tl-ev ${state}`}
                style={{
                  top: (item.startMin - start * 60) * PX_PER_MIN,
                  height: (item.endMin - item.startMin) * PX_PER_MIN - 4,
                  left: `calc(${String(GUTTER)}px + (100% - ${String(GUTTER)}px) * ${String(column / columns)})`,
                  width: `calc((100% - ${String(GUTTER)}px) / ${String(columns)} - 6px)`,
                }}
              >
                <button
                  type="button"
                  className={`mk-ev ${a.id === nextId ? "next" : ""}`}
                  onClick={() => {
                    onOpen(a);
                  }}
                >
                  <MkAvatar name={a.patient.full_name} size="pa" />
                  <div>
                    <b>{a.patient.full_name}</b>
                    <p>
                      <span className="mk-t">{formatTime(a.starts_at, timeZone)}</span> · {a.reason ?? "Consultation"} · {a.room ?? "No room"} · {minutes} min
                      {a.status === "arrived" ? ` · waiting ${String(waitingMinutes(a))} min` : ""}
                    </p>
                  </div>
                  <StatusChip tone={tag.tone}>{tag.label}</StatusChip>
                </button>
              </li>
            );
          })}
          {nowVisible ? (
            <li className="mk-now" aria-label={`Now, ${nowTime}`} style={{ top: (now - start * 60) * PX_PER_MIN }}>
              <div>
                <span>NOW {nowTime}</span>
              </div>
            </li>
          ) : null}
        </ol>
      </div>
    </>
  );
}
