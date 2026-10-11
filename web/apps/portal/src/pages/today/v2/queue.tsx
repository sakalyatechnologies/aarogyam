import { Undo2 } from "lucide-react";

import { formatRupees, formatTime } from "@aarogyam/app-kit";

import { MkAvatar } from "../../../components/mk/index.js";
import { displayName } from "../../../lib/patients.js";
import { usePatientPeek } from "../../../layout/peek.js";
import { waitingMinutes } from "../today-page.js";
import { useBoard } from "./board-context.js";
import { useShowMoney } from "./money.js";
import { useDayToday } from "./queries.js";
import { seeingOrder, useZone, type Appointment } from "./seeing.js";
import { Body, Empty, WidgetCard, type WidgetProps } from "./widget-parts.js";
import { APPOINTMENT_CHIP } from "../../../lib/appointment-status.js";
import { useClinic } from "../../../clinic.js";

/** The dot beside a queue row: green in the chair, blue waiting, grey still to come. */
const DOT: Readonly<Record<Appointment["status"], string>> = {
  in_chair: "chair",
  arrived: "waiting",
  requested: "later",
  booked: "later",
  confirmed: "later",
  completed: "later",
  no_show: "later",
  cancelled: "later",
};

/** The patient queue for the chosen day, numbered with a status dot, and the visits already completed. Each list scrolls inside its own box. */
export function QueueWidget({ spec }: WidgetProps) {
  const { date, setDate, todayIso } = useBoard();
  const { can } = useClinic();
  const [showMoney] = useShowMoney();
  const day = useDayToday(date);
  const zone = useZone();
  const peek = usePatientPeek();
  const live = date === undefined || date === todayIso;
  return (
    <WidgetCard
      title="Patient queue"
      subtitle={
        day.data === undefined
          ? undefined
          : live
            ? `${String(day.data.counts.arrived + day.data.counts.in_chair)} in clinic`
            : `${String(seeingOrder(day.data).length)} not yet seen`
      }
      action={
        live ? undefined : (
          <button
            type="button"
            className="tv2-chip"
            onClick={() => {
              setDate(undefined);
            }}
          >
            <Undo2 className="size-3.5" aria-hidden="true" />
            Back to today
          </button>
        )
      }
    >
      <Body
        query={day}
        label={spec.label}
        isEmpty={(t) => t.appointments.every((a) => a.status === "cancelled") && t.completed_visits.length === 0}
        empty={<Empty title="Nobody in the queue" description={live ? "Check someone in and they show up here." : "No visits that day."} />}
      >
        {(today) => {
          const rows = seeingOrder(today);
          return (
            <div className="tv2-queue">
              <div className="tv2-qbox">
                {rows.length === 0 ? (
                  <p className="tv2-sub">{live ? "No one is waiting right now." : "No open visits that day."}</p>
                ) : (
                  <ol aria-label="Patient queue" className="tv2-list tv2-qlist">
                    {rows.map((a, index) => (
                      <li key={a.id}>
                        <button
                          type="button"
                          onClick={() => {
                            peek({ id: a.patient.id, name: a.patient.full_name, number: a.patient.number });
                          }}
                        >
                          <span className="tv2-qn" aria-hidden="true">
                            {index + 1}
                          </span>
                          <MkAvatar name={a.patient.full_name} />
                          <span className="tv2-grow">
                            <span className="tv2-name">{displayName(a.patient.full_name)}</span>
                            <span className="tv2-sub">
                              {[formatTime(a.starts_at, zone), a.status === "arrived" ? `waiting ${String(waitingMinutes(a, today.as_of))} min` : a.reason].filter((part) => part != null && part !== "").join(" · ")}
                            </span>
                          </span>
                          <span className="tv2-dot" data-state={DOT[a.status]} aria-hidden="true" />
                          <span className="tv2-sr">{APPOINTMENT_CHIP[a.status].label}</span>
                        </button>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
              <h3 className="tv2-h3">Completed ({today.completed_visits.length})</h3>
              <div className="tv2-qbox">
                {today.completed_visits.length === 0 ? (
                  <p className="tv2-sub">No visits closed yet.</p>
                ) : (
                  <ul aria-label="Completed visits" className="tv2-list tv2-qlist">
                    {today.completed_visits.map((v) => (
                      <li key={v.visit_id}>
                        <button
                          type="button"
                          onClick={() => {
                            peek({ id: v.patient.id, name: v.patient.full_name, number: v.patient.number });
                          }}
                        >
                          <MkAvatar name={v.patient.full_name} />
                          <span className="tv2-grow">
                            <span className="tv2-name">{displayName(v.patient.full_name)}</span>
                            <span className="tv2-sub">
                              {formatTime(v.ended_at, zone)}
                              {v.clinician_name == null ? "" : ` · ${v.clinician_name}`}
                            </span>
                          </span>
                          {v.billed_paise == null || !showMoney || !can("finance.view") ? null : <span className="tv2-amount">{formatRupees(v.billed_paise)}</span>}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          );
        }}
      </Body>
    </WidgetCard>
  );
}
