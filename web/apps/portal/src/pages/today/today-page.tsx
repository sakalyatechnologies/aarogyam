import { Download, Play } from "lucide-react";
import { Link } from "react-router";

import { apiErrorOf, type AppointmentStatus, type PendingItem, type Today, type TodayMoney } from "@aarogyam/api-client";
import { ApiErrorNotice, formatRupees, formatTime, useDocumentTitle } from "@aarogyam/app-kit";
import { EmptyState, Skeleton } from "@sakalya/ui";

import { Bars, Donut, Empty, Kpi, MkAvatar, MkCard, Tag, type TagTone } from "../../components/mk/index.js";
import { useClinic } from "../../clinic.js";
import { usePatientPeek } from "../../layout/peek.js";
import { patientPath } from "../../lib/patients.js";
import { compactRupees } from "../../lib/money.js";
import { useToday } from "../../queries.js";
import { useTodayMoney } from "../billing/queries.js";

const MINUTE = 60_000;

type TodayAppointment = Today["appointments"][number];
type TodayAttentionItem = Today["attention"][number];
type TodayChair = Today["chairs"][number];
type TodayTeamMember = Today["team"][number];
type TodayQueueToken = Today["recent_patients"][number];

function waitingMinutes(appointment: TodayAppointment, asOf: string): number {
  return appointment.arrived_at == null ? 0 : Math.max(0, Math.round((Date.parse(asOf) - Date.parse(appointment.arrived_at)) / MINUTE));
}

const TAGS: Readonly<Record<AppointmentStatus, { label: string; tone: TagTone }>> = {
  requested: { label: "REQUESTED", tone: "wait" },
  booked: { label: "BOOKED", tone: "next" },
  confirmed: { label: "CONFIRMED", tone: "info" },
  arrived: { label: "WAITING", tone: "wait" },
  in_chair: { label: "IN CHAIR", tone: "next" },
  completed: { label: "DONE", tone: "done" },
  cancelled: { label: "CANCELLED", tone: "neutral" },
  no_show: { label: "NO-SHOW", tone: "down" },
};

function greeting(asOf: string, timeZone: string): string {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone }).format(new Date(asOf)));
  return hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
}

function longDate(asOf: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone }).formatToParts(new Date(asOf));
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("weekday")} · ${get("day")} ${get("month")} ${get("year")}`;
}

/** Today: the day at a glance, in the mock-up's layout. Numbers come from the API; gaps show as empty. */
export function TodayPage() {
  const { session, can } = useClinic();
  useDocumentTitle("Today", session.clinic.name);
  const today = useToday();
  return today.isPending ? (
    <div className="mk-panel" role="status" aria-label="Loading today">
      <h1 className="mk-sr">Today</h1>
      <div className="mk-kpis">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} shape="block" />
        ))}
      </div>
    </div>
  ) : today.isError && apiErrorOf(today.error)?.status === 404 ? (
    <EmptyState
      title="Appointments aren't connected yet"
      description="Today's schedule and queue appear here once the API serves appointments. Patients work already."
      action={
        <Link to="/patients" className="text-sm font-semibold text-primary-text hover:underline">
          Go to patients
        </Link>
      }
    />
  ) : today.isError ? (
    <ApiErrorNotice title="Couldn't load today" error={today.error} onRetry={() => void today.refetch()} />
  ) : (
    <TodayBody today={today.data} timeZone={session.clinic.timezone} showMoney={can("finance.view")} />
  );
}

function TodayBody({ today, timeZone, showMoney }: { today: Today; timeZone: string; showMoney: boolean }) {
  const { session, can } = useClinic();
  const money = useTodayMoney(showMoney);
  const peek = usePatientPeek();
  const booked = today.appointments.filter((a) => a.status !== "cancelled");
  const waiting = booked.filter((a) => a.status === "arrived").sort((a, b) => (a.arrived_at ?? "").localeCompare(b.arrived_at ?? ""));
  const upcoming = booked.filter((a) => a.status === "requested" || a.status === "booked" || a.status === "confirmed");
  const now = booked.find((a) => a.status === "in_chair") ?? waiting[0];
  const nextUp = now === undefined ? upcoming[0] : [...waiting.filter((a) => a !== now), ...upcoming][0];
  const target = nextUp ?? now;
  const hours = today.by_hour.map((bar) => {
    const h12 = bar.hour % 12 === 0 ? 12 : bar.hour % 12;
    const label = `${String(h12)}${bar.hour >= 12 ? "p" : "a"}`;
    return { label, value: bar.booked, done: bar.completed > 0 && bar.completed >= bar.booked, tip: `${String(bar.booked)} appts · ${String(bar.completed)} done · ${label}` };
  });
  const chairsInUse = today.chairs.filter((c) => c.status === "in_use").length;
  const firstName = session.user.display_name.split(" ")[0] ?? session.user.display_name;
  const firstUpcoming = nextUp?.id;
  const nowTime = formatTime(today.as_of, timeZone);
  const nowIndex = today.appointments.findIndex((a) => a.starts_at > today.as_of);
  const rows = today.appointments.flatMap((a, index) => [
    ...(index === nowIndex ? [{ kind: "now" as const }] : []),
    { kind: "appointment" as const, a },
  ]);
  if (nowIndex === -1 && today.appointments.length > 0) {
    rows.push({ kind: "now" });
  }
  const pendingItems = money.data?.pending ?? [];

  return (
    <div className="mk-panel">
      <div className="mk-hero">
        <div className="mk-eyebrow">
          {longDate(today.as_of, timeZone)} · {session.clinic.name}
        </div>
        <h1>
          {greeting(today.as_of, timeZone)}, {firstName}.
        </h1>
        <p>
          {today.counts.total} {today.counts.total === 1 ? "appointment" : "appointments"}, {today.counts.waiting} {today.counts.waiting === 1 ? "patient" : "patients"} waiting.
          {target === undefined ? (
            " Nobody else is booked for today."
          ) : (
            <>
              {" "}
              Your {now === undefined ? "next" : "current"} patient <b style={{ color: "#fff" }}>{target.patient.full_name}</b> {now === undefined ? "is booked" : "is here"}
              {target.room == null ? "" : ` for ${target.room}`} at {formatTime(target.starts_at, timeZone)}.
            </>
          )}
        </p>
        <div className="mk-hero-row">
          {target === undefined ? (
            <button type="button" className="mk-btn mk-btn-primary" disabled>
              <Play aria-hidden="true" /> Start next visit
            </button>
          ) : (
            <Link to={patientPath(target.patient)} className="mk-btn mk-btn-primary">
              <Play aria-hidden="true" /> Start next visit
            </Link>
          )}
          <button
            type="button"
            className="mk-btn mk-btn-ghost"
            onClick={() => {
              window.print();
            }}
          >
            <Download aria-hidden="true" /> Export day plan
          </button>
        </div>
        <div className="mk-hero-stats">
          <div>
            <b>{today.chairs.length === 0 ? "—" : `${String(chairsInUse)} / ${String(today.chairs.length)}`}</b>
            <span>chairs in use</span>
          </div>
          <div>
            <b>
              {today.counts.done} / {today.counts.total}
            </b>
            <span>visits completed</span>
          </div>
          <div>
            <b>{money.data === undefined ? "—" : compactRupees(money.data.collected_paise)}</b>
            <span>collected today</span>
          </div>
          <div>
            <b>—</b>
            <span>avg. rating this week</span>
          </div>
        </div>
      </div>

      <div className="mk-ai">
        <b>✦ Aarogyam AI — morning brief</b>
        <p>The morning brief (recalls, schedule gaps and stock forecasts) arrives with AI Scribe in a later release.</p>
      </div>

      <div className="mk-kpis">
        <Kpi label="Appointments today" value={today.counts.total} pill={`${String(today.counts.done)} done`} pillTone="up" />
        <Kpi label="Patients waiting" value={today.counts.waiting} warn pill={today.attention.length === 0 ? "none urgent" : `${String(today.attention.length)} need attention`} pillTone="warn" />
        {showMoney ? (
          <>
            <Kpi
              label="Revenue today"
              value={money.data === undefined ? "—" : compactRupees(money.data.collected_paise)}
              pill={money.data === undefined ? undefined : `${compactRupees(money.data.collected_this_month_paise)} this month`}
              pillTone="up"
            />
            <Kpi
              label="Pending payments"
              value={money.data === undefined ? "—" : compactRupees(money.data.pending_dues_paise)}
              pill={money.data === undefined ? undefined : money.data.pending_dues_paise > 0 ? "follow-up" : "all clear"}
              pillTone={money.data !== undefined && money.data.pending_dues_paise > 0 ? "down" : "up"}
            />
          </>
        ) : null}
      </div>

      <div className="mk-grid mk-g2">
        <MkCard
          title="Today's schedule"
          hint={`Live timeline · ${String(today.counts.total)} appointments`}
          action={
            <Link to="/calendar" className="mk-link">
              Week view →
            </Link>
          }
        >
          {today.appointments.length === 0 ? (
            <Empty title="No appointments today" />
          ) : (
            <div className="mk-tlwrap">
              <ol className="mk-tl">
                {rows.map((row, index) => {
                  if (row.kind === "now") {
                    return (
                      <li key={`now-${String(index)}`} className="mk-now" aria-label={`Now, ${nowTime}`}>
                        <div>
                          <span>NOW {nowTime}</span>
                        </div>
                      </li>
                    );
                  }
                  const a = row.a;
                  const tag = a.id === firstUpcoming ? { label: "NEXT", tone: "next" as const } : TAGS[a.status];
                  const minutes = Math.round((Date.parse(a.ends_at) - Date.parse(a.starts_at)) / MINUTE);
                  const state = a.status === "completed" ? "done" : a.status === "arrived" ? "wait" : "";
                  return (
                    <li key={a.id} className={state}>
                      <span className="mk-t">{formatTime(a.starts_at, timeZone)}</span>
                      <span className="mk-d" />
                      <button
                        type="button"
                        className={`mk-ev ${a.id === firstUpcoming ? "next" : ""}`}
                        onClick={() => {
                          peek({ id: a.patient.id, name: a.patient.full_name, number: a.patient.number });
                        }}
                      >
                        <MkAvatar name={a.patient.full_name} size="pa" />
                        <div>
                          <b>{a.patient.full_name}</b>
                          <p>
                            {a.reason ?? "Consultation"} · {a.room ?? "No room"} · {minutes} min
                            {a.status === "arrived" ? ` · waiting ${String(waitingMinutes(a, today.as_of))} min` : ""}
                          </p>
                        </div>
                        <Tag tone={tag.tone}>{tag.label}</Tag>
                      </button>
                    </li>
                  );
                })}
              </ol>
            </div>
          )}
        </MkCard>
        <div className="mk-stack">
          <MkCard title="Attention required" hint="Sorted by clinical priority">
            <AttentionSection items={today.attention} />
          </MkCard>
          <MkCard title="Chair status" hint="Live">
            <ChairStatus chairs={today.chairs} timeZone={timeZone} />
          </MkCard>
        </div>
      </div>

      <div className="mk-grid mk-g2r">
        <MkCard title="Appointments by hour" hint="Booked vs completed · hover for detail">
          {hours.length === 0 ? <Empty title="No appointments today" /> : <Bars data={hours} summary="Appointments booked in each hour today" />}
        </MkCard>
        <MkCard
          title="Recent patients"
          hint="Latest arrivals today"
          action={
            can("patients.read") ? (
              <Link to="/patients" className="mk-link">
                All patients →
              </Link>
            ) : undefined
          }
        >
          <RecentPatients tokens={today.recent_patients} appointments={today.appointments} pending={pendingItems} />
        </MkCard>
      </div>

      <div className="mk-grid mk-g3">
        {showMoney ? (
          <>
            <MkCard title="Revenue mix" hint="This month · by treatment">
              <RevenueMix money={money.data} />
            </MkCard>
            <MkCard
              title="Pending payments"
              hint={money.data === undefined ? "" : `${compactRupees(money.data.pending_dues_paise)} across ${String(pendingItems.length)} ${pendingItems.length === 1 ? "bill" : "bills"}`}
            >
              <PendingPayments pending={money.data === undefined ? undefined : pendingItems} />
            </MkCard>
          </>
        ) : null}
        <MkCard title="Team today" hint={`On duty · ${String(today.team.length)} ${today.team.length === 1 ? "doctor" : "doctors"}`}>
          <TeamToday team={today.team} />
        </MkCard>
      </div>
    </div>
  );
}

function AttentionSection({ items }: { items: readonly TodayAttentionItem[] }) {
  if (items.length === 0) {
    return <Empty title="Nothing needs attention">Late arrivals and long waits appear here.</Empty>;
  }
  return (
    <ul className="mk-att">
      {items.map((item, index) => (
        <li key={item.appointment_id ?? item.queue_token_id ?? `attention-${String(index)}`}>
          <span className={`mk-pri ${item.kind === "long_wait" ? "high" : "med"}`} />
          <div>
            <b>{item.patient.full_name}</b>
            <p>{item.message}</p>
          </div>
          <Link to={patientPath(item.patient)} className="mk-mini">
            Review
          </Link>
        </li>
      ))}
    </ul>
  );
}

function ChairStatus({ chairs, timeZone }: { chairs: readonly TodayChair[]; timeZone: string }) {
  if (chairs.length === 0) {
    return <Empty title="No chairs set up yet">Add chairs in Settings to see their status here.</Empty>;
  }
  return (
    <div className="mk-chairs">
      {chairs.map((chair) => (
        <div key={chair.room_id} className={`mk-chair ${chair.status === "in_use" ? "use" : ""}`}>
          <b>{chair.name}</b>
          <div>
            {chair.current
              ? `${chair.current.patient.full_name} · ${formatTime(chair.current.starts_at, timeZone)}`
              : chair.next
                ? `Free · next ${formatTime(chair.next.starts_at, timeZone)}`
                : "Free"}
          </div>
        </div>
      ))}
    </div>
  );
}

function RecentPatients({ tokens, appointments, pending }: { tokens: readonly TodayQueueToken[]; appointments: Today["appointments"]; pending: readonly PendingItem[] }) {
  const peek = usePatientPeek();
  if (tokens.length === 0) {
    return <Empty title="Nobody has come in yet">Patients who arrive today will show here.</Empty>;
  }
  return (
    <div className="mk-tablewrap">
      <table className="mk-table">
        <caption className="mk-sr">Recent patients</caption>
        <thead>
          <tr>
            <th scope="col">Patient</th>
            <th scope="col">Treatment</th>
            <th scope="col">Status</th>
            <th scope="col">Bill</th>
          </tr>
        </thead>
        <tbody>
          {tokens.slice(0, 6).map((t) => {
            const treatment = appointments.find((a) => a.patient.id === t.patient.id)?.reason;
            const owed = pending.filter((p) => p.patient.id === t.patient.id).reduce((sum, p) => sum + p.balance_paise, 0);
            return (
              <tr key={t.id}>
                <th scope="row">
                  <button
                    type="button"
                    className="mk-pname"
                    onClick={() => {
                      peek({ id: t.patient.id, name: t.patient.full_name, number: t.patient.number });
                    }}
                  >
                    <MkAvatar name={t.patient.full_name} />
                    {t.patient.full_name}
                  </button>
                </th>
                <td>{treatment ?? "—"}</td>
                <td>
                  <Tag tone={t.status === "done" ? "done" : t.status === "in_chair" ? "next" : t.status === "left" ? "neutral" : "wait"}>
                    {t.status === "done" ? "DONE" : t.status === "in_chair" ? "IN CHAIR" : t.status === "left" ? "LEFT" : "WAITING"}
                  </Tag>
                </td>
                <td>{owed > 0 ? formatRupees(owed) : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const CATEGORY_LABEL: Readonly<Record<string, string>> = {
  consultation: "Consultation",
  preventive: "Preventive",
  restorative: "Restorative",
  endodontics: "Endodontics",
  oral_surgery: "Oral surgery",
  orthodontics: "Orthodontics",
  medicines: "Medicines",
  other: "Other",
};

function RevenueMix({ money }: { money: TodayMoney | undefined }) {
  if (money === undefined) {
    return <Skeleton shape="block" />;
  }
  if (money.revenue_mix.length === 0) {
    return <Empty title="No bills issued this month">The revenue mix appears once bills are issued.</Empty>;
  }
  return (
    <Donut
      data={money.revenue_mix.map((m) => ({ label: CATEGORY_LABEL[m.category] ?? m.category, value: m.amount_paise }))}
      centre={compactRupees(money.revenue_mix.reduce((sum, m) => sum + m.amount_paise, 0))}
      summary="This month's billed amount by category"
    />
  );
}

function PendingPayments({ pending }: { pending: readonly PendingItem[] | undefined }) {
  if (pending === undefined) {
    return <Skeleton shape="block" />;
  }
  if (pending.length === 0) {
    return <Empty title="Nothing pending">Every issued bill is paid in full.</Empty>;
  }
  return (
    <>
      <div className="mk-tablewrap">
        <table className="mk-table">
          <caption className="mk-sr">Pending payments</caption>
          <tbody>
            {pending.slice(0, 3).map((i) => (
              <tr key={i.invoice_id}>
                <th scope="row">
                  <Link to={`/billing/invoices/${i.invoice_id}`}>{i.patient.name}</Link>
                </th>
                <td>{formatRupees(i.balance_paise)}</td>
                <td>
                  <Tag tone={i.paid_paise > 0 ? "info" : "wait"}>{i.paid_paise > 0 ? "PARTIAL" : "DUE"}</Tag>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button type="button" className="mk-btn mk-btn-ghost" style={{ marginTop: 12, width: "100%" }} disabled title="WhatsApp reminders arrive with Messages">
        Remind all on WhatsApp
      </button>
    </>
  );
}

function TeamToday({ team }: { team: readonly TodayTeamMember[] }) {
  if (team.length === 0) {
    return <Empty title="Team today isn't available yet">Shows once a doctor has working hours set for today.</Empty>;
  }
  return (
    <div className="mk-tablewrap">
      <table className="mk-table">
        <caption className="mk-sr">Team today</caption>
        <tbody>
          {team.map((t) => (
            <tr key={t.practitioner.id}>
              <th scope="row">
                <span className="mk-pname">
                  <MkAvatar name={t.practitioner.display_name} />
                  {t.practitioner.display_name}
                </span>
              </th>
              <td>{t.appointments} visits</td>
              <td>
                <Tag tone={t.on_leave ? "wait" : "done"}>{t.on_leave ? "ON LEAVE" : "IN"}</Tag>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
