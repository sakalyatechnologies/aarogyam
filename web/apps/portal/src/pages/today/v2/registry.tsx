/**
 * The widget registry: how each Today widget is drawn. What a widget IS (title, permission, sizes, zones, options) comes
 * from the API's catalogue, the one source the server also validates against; this file holds the matching drawing code
 * and an icon, keyed the same. A test keeps the two in step: every catalogue key has an entry here, and a key the server
 * adds before the portal knows it is simply left off the board.
 */
import {
  Activity,
  AlarmClock,
  Armchair,
  BellRing,
  CalendarCheck,
  CalendarDays,
  CircleCheck,
  Clock,
  CreditCard,
  FlaskConical,
  IndianRupee,
  ListOrdered,
  PieChart,
  UserPlus,
  Users,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState, type ComponentType } from "react";
import { Link } from "react-router";

import type { DashboardCatalogue, OpenLabOrder, Today } from "@aarogyam/api-client";
import { formatRupees, formatTime } from "@aarogyam/app-kit";
import { Carousel, Heatmap, KpiRibbon, MiniMonth, Tag, type KpiItem } from "@sakalya/ui";

import { AppointmentActionButton } from "../../../components/appointment-action.js";
import { Bars, MkAvatar, StatusChip } from "../../../components/mk/index.js";
import { useClinic } from "../../../clinic.js";
import { APPOINTMENT_CHIP } from "../../../lib/appointment-status.js";
import { displayName } from "../../../lib/patients.js";
import { usePatientPeek } from "../../../layout/peek.js";
import { useStaff } from "../../../queries.js";
import { useTodayMoney } from "../../billing/queries.js";
import { DayTimeline } from "../day-timeline.js";
import { AttentionSection, ChairStatus, PendingPayments, RecentPatients, RevenueMix, TeamToday, waitingMinutes } from "../today-page.js";
import { AppointmentsTable } from "./appointments-table.js";
import { useBoard } from "./board-context.js";
import { allowed, type LayoutOpts, type WidgetSpec, type Zone } from "./layout-model.js";
import { useDayToday, useMonthSummary, useOpenLabs, useWeeklyCollections } from "./queries.js";
import { Body, Empty, Loading, WidgetCard } from "./widget-parts.js";

type Appointment = Today["appointments"][number];

export interface WidgetProps {
  spec: WidgetSpec;
  opts: LayoutOpts;
  zone: Zone;
  catalogue: DashboardCatalogue;
}

/** The day's people in the order they will be seen: in the chair, waiting by arrival, then booked by time. */
export function seeingOrder(today: Today): Appointment[] {
  const live = today.appointments.filter((a) => a.status !== "cancelled");
  const inChair = live.filter((a) => a.status === "in_chair");
  const waiting = live.filter((a) => a.status === "arrived").sort((a, b) => (a.arrived_at ?? "").localeCompare(b.arrived_at ?? ""));
  const upcoming = live.filter((a) => a.status === "requested" || a.status === "booked" || a.status === "confirmed").sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  return [...inChair, ...waiting, ...upcoming];
}

const KIND_LABEL: Readonly<Record<Appointment["kind"], string>> = { new: "New", follow_up: "Follow-up", procedure: "Procedure", emergency: "Emergency" };

function useZone() {
  return useClinic().session.clinic.timezone;
}

function numberOpt(opts: LayoutOpts, key: string, fallback: number): number {
  const value = opts[key];
  return typeof value === "number" ? value : fallback;
}

// Key numbers -------------------------------------------------------------------------------------

const METRIC_ICON: Readonly<Record<string, LucideIcon>> = {
  appointments: CalendarDays,
  completed: CircleCheck,
  waiting: Clock,
  new_patients: UserPlus,
  collected: IndianRupee,
  outstanding: CreditCard,
  chairs_busy: Armchair,
  lab_due: FlaskConical,
};

function KpisWidget({ opts, catalogue, spec }: WidgetProps) {
  const { date } = useBoard();
  const { can } = useClinic();
  const day = useDayToday(date);
  const labs = useOpenLabs(can("labs.read"));
  const money = useTodayMoney(can("finance.view"));
  const wanted = Array.isArray(opts["metrics"]) ? opts["metrics"].filter((m): m is string => typeof m === "string") : [];
  // A number the member may not see is left out, not shown as a zero.
  const metrics = wanted.flatMap((key) => {
    const info = catalogue.metrics.find((m) => m.key === key);
    return info !== undefined && allowed(info.requires, can) ? [info] : [];
  });
  return (
    <Body query={day} label={spec.label} rows={2} empty={null}>
      {(today) => {
        if (metrics.length === 0) return <Empty title="No numbers to show" description="Pick numbers for this row in the Dashboard studio." />;
        const items: KpiItem[] = [];
        for (const metric of metrics) {
          const Icon = METRIC_ICON[metric.key] ?? Activity;
          const base = { id: metric.key, label: metric.label, icon: <Icon className="size-4" aria-hidden="true" /> };
          switch (metric.key) {
            case "appointments":
              items.push({ ...base, value: today.counts.total, hint: `${String(today.counts.done)} done` });
              break;
            case "completed":
              items.push({ ...base, value: today.counts.done, hint: `${String(Math.max(0, today.counts.total - today.counts.done - today.counts.cancelled - today.counts.no_shows))} to go` });
              break;
            case "waiting":
              items.push({ ...base, value: today.counts.waiting, hint: today.attention.length === 0 ? "None urgent" : `${String(today.attention.length)} need attention` });
              break;
            case "new_patients":
              items.push({ ...base, value: today.appointments.filter((a) => a.kind === "new" && a.status !== "cancelled").length, hint: "First visits" });
              break;
            case "collected":
              if (today.money != null) items.push({ ...base, value: today.money.collected_paise / 100, prefix: "₹", hint: `${String(today.money.payments)} payments` });
              break;
            case "outstanding":
              if (money.data !== undefined) items.push({ ...base, value: money.data.pending_dues_paise / 100, prefix: "₹", hint: `${String(money.data.pending_dues_patients)} patients` });
              break;
            case "chairs_busy":
              items.push({ ...base, value: today.chairs.filter((c) => c.status === "in_use").length, hint: `of ${String(today.chairs.length)} chairs` });
              break;
            case "lab_due": {
              const due = labs.data?.items.filter((o) => o.late || o.due_on === today.date).length;
              if (due !== undefined) items.push({ ...base, value: due, hint: "Due or late" });
              break;
            }
            default:
              break;
          }
        }
        return items.length === 0 ? <Loading label={spec.label} rows={2} /> : (
          <div className="tv2-kpis" data-count={items.length}>
            <KpiRibbon items={items} labels={{ summary: "Key numbers" }} locale="en-IN" />
          </div>
        );
      }}
    </Body>
  );
}

// Next up -----------------------------------------------------------------------------------------

function NextupWidget({ opts, spec }: WidgetProps) {
  const { date } = useBoard();
  const day = useDayToday(date);
  const zone = useZone();
  const peek = usePatientPeek();
  const count = numberOpt(opts, "count", 3);
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
                      <p className="tv2-eyebrow">
                        {index === 0 ? (a.status === "in_chair" ? "In the chair" : "Next up") : `Then · #${String(index + 1)}`} · {formatTime(a.starts_at, zone)}
                      </p>
                      <p className="tv2-name">{displayName(a.patient.full_name)}</p>
                      <p className="tv2-sub">{[KIND_LABEL[a.kind], a.reason, a.room].filter((part) => part != null && part !== "").join(" · ")}</p>
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

// Queue and completed -----------------------------------------------------------------------------

function QueueWidget({ spec }: WidgetProps) {
  const { date, todayIso } = useBoard();
  const day = useDayToday(date);
  const zone = useZone();
  const peek = usePatientPeek();
  const live = date === undefined || date === todayIso;
  return (
    <WidgetCard title={spec.label} subtitle={live ? "Who is waiting, and for how long" : "That day's queue and completed visits"}>
      <Body
        query={day}
        label={spec.label}
        isEmpty={(t) => t.appointments.every((a) => a.status === "cancelled") && t.completed_visits.length === 0}
        empty={<Empty title="Nobody in the queue" description={live ? "Check someone in and they show up here." : "No visits that day."} />}
      >
        {(today) => {
          const order = seeingOrder(today);
          const rows = live ? order.filter((a) => a.status === "in_chair" || a.status === "arrived") : order;
          return (
            <div className="tv2-queue">
              {rows.length === 0 ? <p className="tv2-sub">{live ? "No one is waiting right now." : "No open visits that day."}</p> : null}
              {rows.length === 0 ? null : (
                <ol aria-label={live ? "Waiting now" : "Not yet seen"} className="tv2-list">
                  {rows.map((a) => (
                    <li key={a.id}>
                      <button
                        type="button"
                        onClick={() => {
                          peek({ id: a.patient.id, name: a.patient.full_name, number: a.patient.number });
                        }}
                      >
                        <MkAvatar name={a.patient.full_name} />
                        <span className="tv2-grow">
                          <span className="tv2-name">{displayName(a.patient.full_name)}</span>
                          <span className="tv2-sub">
                            {formatTime(a.starts_at, zone)}
                            {a.status === "arrived" ? ` · waiting ${String(waitingMinutes(a, today.as_of))} min` : ""}
                          </span>
                        </span>
                        <StatusChip tone={APPOINTMENT_CHIP[a.status].tone}>{APPOINTMENT_CHIP[a.status].label}</StatusChip>
                      </button>
                    </li>
                  ))}
                </ol>
              )}
              <h3 className="tv2-h3">Completed ({today.completed_visits.length})</h3>
              {today.completed_visits.length === 0 ? (
                <p className="tv2-sub">No visits closed yet.</p>
              ) : (
                <ul aria-label="Completed visits" className="tv2-list">
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
                        {v.billed_paise == null ? null : <span className="tv2-amount">{formatRupees(v.billed_paise)}</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        }}
      </Body>
    </WidgetCard>
  );
}

// Appointments ------------------------------------------------------------------------------------

function AppointmentsWidget({ opts, spec }: WidgetProps) {
  const { date } = useBoard();
  const day = useDayToday(date);
  const zone = useZone();
  const peek = usePatientPeek();
  const asTable = opts["view"] !== "list";
  return (
    <WidgetCard title={date === undefined ? "Today's appointments" : "Appointments"} subtitle={asTable ? "Every visit with its type and status" : "In time order"}>
      <Body query={day} label={spec.label} isEmpty={(t) => t.appointments.length === 0} empty={<Empty title="No appointments" description="Nothing is booked for this day." />}>
        {(today) => {
          const rows = [...today.appointments].sort((a, b) => a.starts_at.localeCompare(b.starts_at));
          const open = (a: Appointment) => {
            peek({ id: a.patient.id, name: a.patient.full_name, number: a.patient.number });
          };
          return asTable ? (
            <AppointmentsTable rows={rows} zone={zone} onOpen={open} />
          ) : (
            <ul aria-label="Appointments" className="tv2-list">
              {rows.map((a) => (
                <li key={a.id}>
                  <button type="button" onClick={() => { open(a); }}>
                    <span className="tv2-mono">{formatTime(a.starts_at, zone)}</span>
                    <span className="tv2-grow">
                      <span className="tv2-name">{displayName(a.patient.full_name)}</span>
                      <span className="tv2-sub">{[a.reason, a.room].filter((part) => part != null && part !== "").join(" · ") || a.practitioner.display_name}</span>
                    </span>
                    <StatusChip tone={APPOINTMENT_CHIP[a.status].tone}>{APPOINTMENT_CHIP[a.status].label}</StatusChip>
                  </button>
                </li>
              ))}
            </ul>
          );
        }}
      </Body>
    </WidgetCard>
  );
}

// Chairs, attention, timeline ---------------------------------------------------------------------

function ChairsWidget({ opts, spec }: WidgetProps) {
  const { date } = useBoard();
  const day = useDayToday(date);
  const zone = useZone();
  const chart = opts["show_chart"] !== false;
  return (
    <WidgetCard title={spec.label} subtitle={chart ? "Who is in each chair, and the busy hours" : "Who is in each chair"}>
      <Body query={day} label={spec.label} empty={null}>
        {(today) => {
          const hours = today.by_hour.map((bar) => {
            const h12 = bar.hour % 12 === 0 ? 12 : bar.hour % 12;
            const label = `${String(h12)}${bar.hour >= 12 ? "p" : "a"}`;
            return { label, value: bar.booked, done: bar.completed > 0 && bar.completed >= bar.booked, tip: `${String(bar.booked)} appts · ${String(bar.completed)} done · ${label}` };
          });
          return (
            <>
              <ChairStatus chairs={today.chairs} timeZone={zone} />
              {chart && hours.length > 0 ? (
                <div className="tv2-chart">
                  <Bars data={hours} summary="Appointments booked in each hour" />
                </div>
              ) : null}
            </>
          );
        }}
      </Body>
    </WidgetCard>
  );
}

function AttentionWidget({ spec }: WidgetProps) {
  const { date } = useBoard();
  const day = useDayToday(date);
  const zone = useZone();
  return (
    <WidgetCard title={spec.label} subtitle="Late arrivals, long waits, requests and stock">
      <Body query={day} label={spec.label} empty={null}>
        {(today) => {
          const requests = today.appointments.filter((a) => a.status === "requested");
          return (
            <>
              {requests.length === 0 ? null : (
                <ul aria-label="Booking requests to confirm" className="tv2-list tv2-requests">
                  {requests.map((a) => (
                    <li key={a.id}>
                      <Link to={"/calendar"}>
                        <BellRing aria-hidden="true" className="size-4" />
                        <span className="tv2-grow">
                          <span className="tv2-name">Confirm {displayName(a.patient.full_name)}</span>
                          <span className="tv2-sub">{formatTime(a.starts_at, zone)} · {a.reason ?? "Booking request"}</span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              <AttentionSection items={today.attention} lowStock={today.low_stock ?? []} appointments={today.appointments} timeZone={zone} />
            </>
          );
        }}
      </Body>
    </WidgetCard>
  );
}

function TimelineWidget({ spec }: WidgetProps) {
  const { date } = useBoard();
  const day = useDayToday(date);
  const zone = useZone();
  const peek = usePatientPeek();
  return (
    <WidgetCard title={spec.label} subtitle="The day hour by hour">
      <Body query={day} label={spec.label} isEmpty={(t) => t.appointments.length === 0} empty={<Empty title="No appointments" description="The timeline fills in as visits are booked." />}>
        {(today) => (
          <DayTimeline
            appointments={today.appointments}
            asOf={today.as_of}
            timeZone={zone}
            nextId={seeingOrder(today).find((a) => a.status !== "in_chair")?.id}
            waitingMinutes={(a) => waitingMinutes(a, today.as_of)}
            onOpen={(a) => {
              peek({ id: a.patient.id, name: a.patient.full_name, number: a.patient.number });
            }}
          />
        )}
      </Body>
    </WidgetCard>
  );
}

// Labs --------------------------------------------------------------------------------------------

const STAGE_LABEL: Readonly<Record<OpenLabOrder["pipeline_stage"], string>> = {
  to_send: "To send",
  sent: "At the lab",
  in_progress: "In progress",
  ready_to_fit: "Ready to fit",
  fitted: "Fitted",
  rework: "Rework",
  cancelled: "Cancelled",
};

function LabsWidget({ spec }: WidgetProps) {
  const labs = useOpenLabs(true);
  return (
    <WidgetCard title={spec.label} subtitle="Open orders by stage" action={<Link to="/labs" className="tv2-link">All</Link>}>
      <Body query={labs} label={spec.label} isEmpty={(page) => page.items.length === 0} empty={<Empty title="No open lab work" description="Orders show here until they are fitted." />}>
        {(page) => {
          const late = page.items.filter((o) => o.late).length;
          const stages = [...new Set(page.items.map((o) => o.pipeline_stage))];
          return (
            <>
              <p className="tv2-chips">
                {stages.map((stage) => (
                  <Tag key={stage}>
                    {STAGE_LABEL[stage]} {page.items.filter((o) => o.pipeline_stage === stage).length}
                  </Tag>
                ))}
                {late === 0 ? null : <Tag tone="danger">{late} late</Tag>}
              </p>
              <ul aria-label="Open lab orders" className="tv2-list">
                {page.items.slice(0, 5).map((o) => (
                  <li key={o.id}>
                    <Link to={"/labs"}>
                      <span className="tv2-grow">
                        <span className="tv2-name">{displayName(o.patient_name)}</span>
                        <span className="tv2-sub">{[o.vendor_name, STAGE_LABEL[o.pipeline_stage], o.due_on == null ? null : `due ${o.due_on}`].filter((part) => part != null).join(" · ")}</span>
                      </span>
                      {o.late ? <Tag tone="danger">{o.days_late == null ? "Late" : `${String(o.days_late)}d late`}</Tag> : null}
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          );
        }}
      </Body>
    </WidgetCard>
  );
}

// Calendar ----------------------------------------------------------------------------------------

const MONTH_NAMES = Array.from({ length: 12 }, (_, month) => new Intl.DateTimeFormat("en-GB", { month: "long", timeZone: "UTC" }).format(Date.UTC(2023, month, 1)));

/** Reads the month MiniMonth is showing from its heading, so the busy days follow its own previous and next buttons. */
function shownMonthOf(root: HTMLElement | null): string | undefined {
  const text = root?.querySelector("[aria-live]")?.textContent ?? "";
  const match = /^(\p{L}+) (\d{4})$/u.exec(text.trim());
  const month = match === null ? -1 : MONTH_NAMES.indexOf(match[1] ?? "");
  return match === null || month < 0 ? undefined : `${match[2] ?? ""}-${String(month + 1).padStart(2, "0")}`;
}

function CalendarWidget({ spec }: WidgetProps) {
  const { date, setDate, todayIso } = useBoard();
  const root = useRef<HTMLDivElement>(null);
  const start = (date ?? todayIso ?? "").slice(0, 7);
  const [month, setMonth] = useState<string | undefined>(undefined);
  const shown = month ?? start;
  const summary = useMonthSummary(shown, shown !== "");
  useEffect(() => {
    const el = root.current;
    if (el === null) return undefined;
    const read = () => {
      const next = shownMonthOf(el);
      if (next !== undefined) setMonth(next);
    };
    read();
    const watch = new MutationObserver(read);
    watch.observe(el, { childList: true, subtree: true, characterData: true });
    return () => {
      watch.disconnect();
    };
  }, [todayIso]);
  const busy = summary.data?.days.filter((d) => d.total > 0).map((d) => d.date) ?? [];
  const day = date ?? todayIso;
  return (
    <WidgetCard title={spec.label} subtitle="Pick a day to see it here">
      <div ref={root}>
        {todayIso === undefined ? (
          <Loading label={spec.label} rows={4} />
        ) : (
          <MiniMonth
            {...(day === undefined ? {} : { value: day })}
            today={todayIso}
            busy={busy}
            locale="en-GB"
            labels={{ busy: "has appointments" }}
            onValueChange={(next) => {
              setDate(next === todayIso ? undefined : next);
            }}
          />
        )}
      </div>
      {summary.isError ? <p role="status" className="tv2-sub">Busy days could not be loaded.</p> : null}
    </WidgetCard>
  );
}

// Recent patients, team ---------------------------------------------------------------------------

function RecentPatientsWidget({ spec }: WidgetProps) {
  const { date } = useBoard();
  const { can } = useClinic();
  const day = useDayToday(date);
  const money = useTodayMoney(can("finance.view"));
  return (
    <WidgetCard title={spec.label} subtitle="Latest arrivals" action={<Link to="/patients" className="tv2-link">View all</Link>}>
      <Body query={day} label={spec.label} empty={null}>
        {(today) => <RecentPatients tokens={today.recent_patients} appointments={today.appointments} pending={money.data?.pending ?? []} />}
      </Body>
    </WidgetCard>
  );
}

function TeamTodayWidget({ spec }: WidgetProps) {
  const { date } = useBoard();
  const { can } = useClinic();
  const day = useDayToday(date);
  const staff = useStaff(can("staff.manage"));
  return (
    <WidgetCard title={spec.label} subtitle="On duty">
      <Body query={day} label={spec.label} isEmpty={(t) => t.team.length === 0} empty={<Empty title="No one on the roster" description="Add doctors and their hours in Settings." />}>
        {(today) => <TeamToday team={today.team} staff={staff.data?.members ?? []} />}
      </Body>
    </WidgetCard>
  );
}

// Money -------------------------------------------------------------------------------------------

function CollectionsWidget({ opts, spec }: WidgetProps) {
  const weeks = numberOpt(opts, "weeks", 8);
  const report = useWeeklyCollections(weeks, true);
  return (
    <WidgetCard title={spec.label} subtitle={`Money collected, last ${String(weeks)} weeks`} action={<Link to="/billing" className="tv2-link">Billing</Link>}>
      <Body query={report} label={spec.label} isEmpty={(r) => r.by_week.length === 0 || r.by_week.every((w) => w.amount_paise === 0)} empty={<Empty title="Nothing collected yet" description="Payments you record show here week by week." />}>
        {(r) => (
          <>
            <div className="tv2-chart">
              <Bars
                summary={`Collections per week, last ${String(weeks)} weeks`}
                data={r.by_week.map((w) => ({ label: w.date.slice(5), value: w.amount_paise / 100, tip: `${w.date}: ${formatRupees(w.amount_paise)}` }))}
              />
            </div>
            <p className="tv2-sub">{formatRupees(r.collected_paise)} in {String(weeks)} weeks</p>
          </>
        )}
      </Body>
    </WidgetCard>
  );
}

function RevenueMixWidget({ spec }: WidgetProps) {
  const money = useTodayMoney(true);
  return (
    <WidgetCard title={spec.label} subtitle="This month, by treatment">
      <Body query={money} label={spec.label} empty={null}>
        {(data) => <RevenueMix money={data} />}
      </Body>
    </WidgetCard>
  );
}

function PendingPaymentsWidget({ spec }: WidgetProps) {
  const money = useTodayMoney(true);
  return (
    <WidgetCard title={spec.label} subtitle="Bills with money still due" action={<Link to="/billing" className="tv2-link">Billing</Link>}>
      <Body query={money} label={spec.label} empty={null}>
        {(data) => <PendingPayments pending={data.pending} />}
      </Body>
    </WidgetCard>
  );
}

// Busy hours --------------------------------------------------------------------------------------

function BusyHoursWidget({ spec }: WidgetProps) {
  const { date } = useBoard();
  const day = useDayToday(date);
  return (
    <WidgetCard title={spec.label} subtitle="The hours that fill up">
      <Body query={day} label={spec.label} isEmpty={(t) => t.by_hour.every((h) => h.booked === 0)} empty={<Empty title="No appointments" description="Busy hours appear once visits are booked." />}>
        {(today) => {
          const hours = today.by_hour;
          const name = (hour: number) => `${String(hour % 12 === 0 ? 12 : hour % 12)}${hour >= 12 ? "p" : "a"}`;
          return (
            <Heatmap
              columns={hours.map((h) => name(h.hour))}
              rows={[
                { id: "booked", label: "Booked", values: hours.map((h) => h.booked) },
                { id: "done", label: "Completed", values: hours.map((h) => h.completed) },
              ]}
              describe={(value, row, column) => `${row.label} at ${column}: ${String(value)}`}
              summary="Appointments booked and completed in each hour"
              showValues
            />
          );
        }}
      </Body>
    </WidgetCard>
  );
}

// Registry ----------------------------------------------------------------------------------------

export interface WidgetEntry {
  key: string;
  icon: LucideIcon;
  render: ComponentType<WidgetProps>;
}

/** Every key the API accepts. Order is the Studio's "add a widget" list. */
export const WIDGET_REGISTRY: readonly WidgetEntry[] = [
  { key: "kpis", icon: Activity, render: KpisWidget },
  { key: "nextup", icon: AlarmClock, render: NextupWidget },
  { key: "chairs", icon: Armchair, render: ChairsWidget },
  { key: "appointments", icon: CalendarCheck, render: AppointmentsWidget },
  { key: "attention", icon: BellRing, render: AttentionWidget },
  { key: "labs", icon: FlaskConical, render: LabsWidget },
  { key: "calendar", icon: CalendarDays, render: CalendarWidget },
  { key: "queue", icon: ListOrdered, render: QueueWidget },
  { key: "collections", icon: IndianRupee, render: CollectionsWidget },
  { key: "timeline", icon: Clock, render: TimelineWidget },
  { key: "recent_patients", icon: Users, render: RecentPatientsWidget },
  { key: "team_today", icon: UsersRound, render: TeamTodayWidget },
  { key: "revenue_mix", icon: PieChart, render: RevenueMixWidget },
  { key: "pending_payments", icon: CreditCard, render: PendingPaymentsWidget },
  { key: "busy_hours", icon: Activity, render: BusyHoursWidget },
];

export const WIDGET_KEYS: readonly string[] = WIDGET_REGISTRY.map((entry) => entry.key);

export function entryOf(key: string): WidgetEntry | undefined {
  return WIDGET_REGISTRY.find((entry) => entry.key === key);
}

export function isKnownWidget(key: string): boolean {
  return entryOf(key) !== undefined;
}
