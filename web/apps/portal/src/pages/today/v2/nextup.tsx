import { ChevronLeft, ChevronRight, TriangleAlert } from "lucide-react";
import { useId, useState } from "react";
import { Link } from "react-router";

import type { Today } from "@aarogyam/api-client";
import { formatTime } from "@aarogyam/app-kit";
import { Carousel } from "@sakalya/ui";

import { AppointmentActionButton } from "../../../components/appointment-action.js";
import { MkAvatar } from "../../../components/mk/index.js";
import { useClinic } from "../../../clinic.js";
import { displayName, patientPath } from "../../../lib/patients.js";
import { usePatientPeek } from "../../../layout/peek.js";
import { useBoard } from "./board-context.js";
import { useDayToday } from "./queries.js";
import { KIND_LABEL, seeingOrder, useZone, type Appointment } from "./seeing.js";
import { Body, Empty, WidgetCard, type WidgetProps } from "./widget-parts.js";

function numberOpt(opts: WidgetProps["opts"], key: string, fallback: number): number {
  const value = opts[key];
  return typeof value === "number" ? value : fallback;
}

const TYPE_LABEL: Readonly<Record<Appointment["patient_type"], string>> = { new: "New", follow_up: "Follow-up" };

const detailOf = (a: Appointment) => [KIND_LABEL[a.kind], a.reason, a.room].filter((part) => part != null && part !== "").join(" · ");

function eyebrowOf(a: Appointment, index: number, zone: string): string {
  const when = formatTime(a.starts_at, zone);
  const chair = a.room == null || a.room === "" ? "" : ` · ${a.room}`;
  const lead = index === 0 ? (a.status === "in_chair" ? "In the chair" : "Next up") : `Then · #${String(index + 1)}`;
  return `${lead} · ${when}${chair}`;
}

/** The next or ongoing patient as a wide dark card, with arrows to look at the next few. */
function Hero({ today, count, label }: { today: Today; count: number; label: string }) {
  const { can } = useClinic();
  const zone = useZone();
  const peek = usePatientPeek();
  const list = seeingOrder(today).slice(0, count);
  const [at, setAt] = useState(0);
  const headingId = useId();
  const index = Math.min(at, Math.max(0, list.length - 1));
  const a = list[index];
  return (
    <section className="tv2-hero" aria-labelledby={headingId}>
      <h2 id={headingId} className="tv2-sr">
        {label}
      </h2>
      {a === undefined ? (
        <div className="tv2-hero-empty">
          <p className="tv2-hero-eyebrow">Next up</p>
          <p className="tv2-hero-name">No one is waiting</p>
          <p className="tv2-hero-sub">Everyone booked has been seen.</p>
        </div>
      ) : (
        <>
          <div className="tv2-hero-top">
            <p className="tv2-hero-eyebrow">{eyebrowOf(a, index, zone)}</p>
            {list.length > 1 ? (
              <div className="tv2-hero-nav">
                <span className="tv2-sr" role="status">
                  {`Patient ${String(index + 1)} of ${String(list.length)}`}
                </span>
                <button
                  type="button"
                  aria-label="Previous patient"
                  disabled={index === 0}
                  onClick={() => {
                    setAt(Math.max(0, index - 1));
                  }}
                >
                  <ChevronLeft className="size-4" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  aria-label="Next patient"
                  disabled={index >= list.length - 1}
                  onClick={() => {
                    setAt(Math.min(list.length - 1, index + 1));
                  }}
                >
                  <ChevronRight className="size-4" aria-hidden="true" />
                </button>
              </div>
            ) : null}
          </div>
          <div className="tv2-hero-body">
            <MkAvatar name={a.patient.full_name} size="pa" />
            <div className="tv2-hero-text">
              <p className="tv2-hero-name">
                <span>{displayName(a.patient.full_name)}</span>
                <span className="tv2-hero-badge">{TYPE_LABEL[a.patient_type]}</span>
              </p>
              <p className="tv2-hero-sub">
                {[a.patient.age_years == null ? null : `${String(a.patient.age_years)} yrs`, a.patient.number, a.reason].filter((part) => part != null && part !== "").join(" · ")}
              </p>
              {today.attention
                .filter((item) => item.patient.id === a.patient.id)
                .slice(0, 1)
                .map((item) => (
                  <p key={item.message} className="tv2-hero-alert">
                    <TriangleAlert className="size-4" aria-hidden="true" />
                    {item.message}
                  </p>
                ))}
            </div>
            <div className="tv2-hero-actions">
              <AppointmentActionButton appointment={a} className="tv2-hero-start" label={(step) => (a.status === "arrived" ? "Start" : step)} />
              {can("patients.read") ? (
                <Link to={patientPath(a.patient)} className="tv2-hero-file">
                  File
                </Link>
              ) : (
                <button
                  type="button"
                  className="tv2-hero-file"
                  onClick={() => {
                    peek({ id: a.patient.id, name: a.patient.full_name, number: a.patient.number });
                  }}
                >
                  File
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </section>
  );
}

/** Next up: a wide hero in the main area or top strip; the small carousel in the side column. */
export function NextupWidget({ opts, spec, zone: place }: WidgetProps) {
  const { date } = useBoard();
  const day = useDayToday(date);
  const zone = useZone();
  const peek = usePatientPeek();
  const count = numberOpt(opts, "count", 3);
  if (place !== "rail") {
    return (
      <Body query={day} label={spec.label} rows={2} empty={null}>
        {(today) => <Hero today={today} count={count} label={spec.label} />}
      </Body>
    );
  }
  return (
    <WidgetCard title={spec.label} subtitle={date === undefined ? "Who is next" : "Left to see that day"}>
      <Body query={day} label={spec.label} rows={2} isEmpty={(t) => seeingOrder(t).length === 0} empty={<Empty title="No one is waiting" description="Everyone booked has been seen." />}>
        {(today) => {
          const list = seeingOrder(today).slice(0, count);
          return (
            <Carousel
              label="Upcoming patients"
              slides={list.map((a, index) => ({
                id: a.id,
                label: displayName(a.patient.full_name),
                content: (
                  <div className="tv2-next">
                    <MkAvatar name={a.patient.full_name} />
                    <div className="tv2-next-text">
                      <p className="tv2-eyebrow">{eyebrowOf(a, index, zone)}</p>
                      <p className="tv2-name">{displayName(a.patient.full_name)}</p>
                      <p className="tv2-sub">{detailOf(a)}</p>
                    </div>
                    <div className="tv2-next-actions">
                      <AppointmentActionButton appointment={a} />
                      <button
                        type="button"
                        className="tv2-link"
                        onClick={() => {
                          peek({ id: a.patient.id, name: a.patient.full_name, number: a.patient.number });
                        }}
                      >
                        Quick look
                      </button>
                    </div>
                  </div>
                ),
              }))}
            />
          );
        }}
      </Body>
    </WidgetCard>
  );
}
