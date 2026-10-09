import { Armchair, ArrowUpRight, CalendarDays, CircleCheck, Clock, ListOrdered, Plus } from "lucide-react";
import { Link } from "react-router";

import { apiErrorOf, type LowStockAlert, type Member, type PendingItem, type Today, type TodayMoney } from "@aarogyam/api-client";
import { ApiErrorNotice, formatRupees, formatTime, useDocumentTitle } from "@aarogyam/app-kit";
import { useToast } from "@sakalya/ui";

import {
  AlertBanner,
  Bars,
  Donut,
  Empty,
  EmptyState,
  HeroCard,
  ListPanel,
  ListRow,
  MkAvatar,
  MkCard,
  ProgressRing,
  SectionHeader,
  Skeleton,
  StatTile,
  StatusChip,
} from "../../components/mk/index.js";
import { AppointmentActionButton, nextAction } from "../../components/appointment-action.js";
import { APPOINTMENT_CHIP } from "../../lib/appointment-status.js";
import { useClinic } from "../../clinic.js";
import { usePatientPeek } from "../../layout/peek.js";
import { DayTimeline } from "./day-timeline.js";
import { FinishSetupCard } from "../setup/finish-card.js";
import { patientPath } from "../../lib/patients.js";
import { compactRupees } from "../../lib/money.js";
import { usePatient, useSetAppointmentStatus, useStaff, useToday } from "../../queries.js";
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
  return (
    <>
      <FinishSetupCard />
      {todayContent(today, session.clinic.timezone, can("finance.view"))}
    </>
  );
}

function todayContent(today: ReturnType<typeof useToday>, timeZone: string, showMoney: boolean) {
  return today.isPending ? (
    <div className="mk-panel" role="status" aria-label="Loading today">
      <h1 className="mk-sr">Today</h1>
      <div className="mk-greet">
        <Skeleton shape="line" style={{ width: 180, height: 11 }} />
        <Skeleton shape="line" style={{ width: "min(420px, 80%)", height: 34, marginTop: 10, borderRadius: 10 }} />
      </div>
      <div className="mk-today">
        <div className="mk-today-main">
          <Skeleton shape="hero" />
          <div className="mk-stats" style={{ marginTop: 16 }}>
            {Array.from({ length: 4 }, (_, index) => (
              <Skeleton key={index} shape="stat" />
            ))}
          </div>
          <Skeleton shape="block" style={{ height: 240 }} />
        </div>
        <div className="mk-today-side">
          <Skeleton shape="block" style={{ height: 120 }} />
          <Skeleton shape="block" style={{ height: 160, marginTop: 18 }} />
        </div>
      </div>
    </div>
  ) : today.isError && apiErrorOf(today.error)?.status === 404 ? (
    <EmptyState
      art="calendar"
      title="Appointments aren't connected yet"
      description="Today's schedule and queue appear here once the API serves appointments. Patients work already."
      action={
        <Link to="/patients" className="mk-btn mk-btn-ghost">
          Go to patients
        </Link>
      }
    />
  ) : today.isError ? (
    <ApiErrorNotice title="Couldn't load today" error={today.error} onRetry={() => void today.refetch()} />
  ) : (
    <TodayBody today={today.data} timeZone={timeZone} showMoney={showMoney} />
  );
}

function TodayBody({ today, timeZone, showMoney }: { today: Today; timeZone: string; showMoney: boolean }) {
  const { session, can } = useClinic();
  const money = useTodayMoney(showMoney);
  const peek = usePatientPeek();
  // The front desk (no clinical access) sees arrivals and checks people in; clinicians see their next consultation.
  const frontDesk = !can("clinical.read");
  const booked = today.appointments.filter((a) => a.status !== "cancelled");
  const waiting = booked.filter((a) => a.status === "arrived").sort((a, b) => (a.arrived_at ?? "").localeCompare(b.arrived_at ?? ""));
  const upcoming = booked.filter((a) => a.status === "requested" || a.status === "booked" || a.status === "confirmed");
  const now = booked.find((a) => a.status === "in_chair") ?? waiting[0];
  // The hero follows the day: whoever is in the chair, else the next person waiting, else the next arrival.
  // Completing a visit drops the patient from this list, so the hero moves on by itself.
  const nextUp = [...waiting.filter((a) => a !== now), ...upcoming][0];
  const target = frontDesk ? upcoming[0] : (now ?? upcoming[0]);
  const hours = today.by_hour.map((bar) => {
    const h12 = bar.hour % 12 === 0 ? 12 : bar.hour % 12;
    const label = `${String(h12)}${bar.hour >= 12 ? "p" : "a"}`;
    return { label, value: bar.booked, done: bar.completed > 0 && bar.completed >= bar.booked, tip: `${String(bar.booked)} appts · ${String(bar.completed)} done · ${label}` };
  });
  const chairsInUse = today.chairs.filter((c) => c.status === "in_use").length;
  const firstName = session.user.display_name.replace(/^dr\.?\s+/i, "Dr ").split(" ").slice(0, session.user.display_name.toLowerCase().startsWith("dr") ? 2 : 1).join(" ");
  const pendingItems = money.data?.pending ?? [];
  const staff = useStaff(can("staff.manage"));
  const staffOthers = staffBesideTeam(today.team, staff.data?.members ?? []).length;
  const comingUp = booked
    .filter((a) => a.status !== "completed" && a.status !== "no_show")
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
    .slice(0, 6);

  return (
    <div className="mk-panel">
      <div className="mk-greet">
        <div className="mk-eyebrow4">
          {longDate(today.as_of, timeZone)} · {session.clinic.name}
        </div>
        <h1>{frontDesk ? `${greeting(today.as_of, timeZone)}, ${firstName}. A smooth day ahead.` : `${greeting(today.as_of, timeZone)}, ${firstName}.`}</h1>
        <p>
          {today.counts.total} {today.counts.total === 1 ? "appointment" : "appointments"} today, {today.counts.waiting} {today.counts.waiting === 1 ? "patient" : "patients"} waiting.
          {frontDesk ? " Check people in as they arrive." : target === undefined ? "" : " Your next patient is ready when you are."}
        </p>
      </div>

      <div className="mk-today">
        <div className="mk-today-main">
          <NextCard target={target} frontDesk={frontDesk} current={!frontDesk && target !== undefined && target === now} today={today} timeZone={timeZone} />

          {showMoney ? (
            <div className="mk-money" aria-label="Money today" role="group">
              <div>
                <span>Revenue today</span>
                <strong>{money.data === undefined ? "—" : formatRupees(money.data.collected_paise)}</strong>
                {money.data === undefined ? null : (
                  <span className="mk-trend good">
                    <ArrowUpRight aria-hidden="true" />
                    {compactRupees(money.data.collected_this_month_paise)} this month
                  </span>
                )}
              </div>
              <div>
                <span>Outstanding</span>
                <strong>{money.data === undefined ? "—" : formatRupees(money.data.pending_dues_paise)}</strong>
                {money.data === undefined ? null : (
                  <span className={`mk-trend ${money.data.pending_dues_paise > 0 ? "bad" : "good"}`}>
                    {money.data.pending_dues_paise > 0 ? `${String(pendingItems.length)} ${pendingItems.length === 1 ? "bill" : "bills"} to follow up` : "All clear"}
                  </span>
                )}
              </div>
              <Link to="/billing" className="mk-link">
                Practice billing →
              </Link>
            </div>
          ) : null}

          <div className="mk-stats" style={{ marginTop: 16 }}>
            <StatTile label="Appointments today" value={today.counts.total} icon={<CalendarDays />} trend={{ direction: "up", text: `${String(today.counts.done)} done`, good: true }} />
            <StatTile
              label="Waiting"
              value={today.counts.waiting}
              tone="warn"
              icon={<Clock />}
              trend={today.attention.length === 0 ? { direction: "flat", text: "None urgent" } : { direction: "up", text: `${String(today.attention.length)} need attention`, good: false }}
            />
            <StatTile label="Completed" value={today.counts.done} icon={<CircleCheck />} trend={{ direction: "flat", text: `${String(Math.max(0, today.counts.total - today.counts.done - today.counts.cancelled - today.counts.no_shows))} to go` }} />
            <StatTile label="Chairs in use" value={today.chairs.length === 0 ? "—" : `${String(chairsInUse)}/${String(today.chairs.length)}`} icon={<Armchair />} />
          </div>

          <SectionHeader title={frontDesk ? "Arrivals and queue" : "Coming up"} action={{ label: "View all", to: "/calendar" }} />
          {comingUp.length === 0 ? (
            <div className="mk-list">
              <EmptyState
                compact
                art="calendar"
                title={today.appointments.length === 0 ? "A clear schedule" : "Everyone has been seen"}
                description={today.appointments.length === 0 ? "No appointments today. Book one, or add a walk-in from the queue." : "No more visits booked for today."}
                action={
                  can("appointments.write") ? (
                    <Link to="/calendar?book=1" className="mk-btn mk-btn-primary">
                      <Plus aria-hidden="true" /> New appointment
                    </Link>
                  ) : undefined
                }
              />
            </div>
          ) : (
            <ListPanel label="Coming up">
              {comingUp.map((a) => (
                <ListRow
                  key={a.id}
                  lead={formatTime(a.starts_at, timeZone)}
                  name={a.patient.full_name}
                  title={a.patient.full_name}
                  subtitle={[a.reason, a.room].filter((part) => part != null && part !== "").join(" · ") || a.practitioner.display_name}
                  trailing={<StatusChip tone={APPOINTMENT_CHIP[a.status].tone}>{APPOINTMENT_CHIP[a.status].label}</StatusChip>}
                  onClick={() => {
                    peek({ id: a.patient.id, name: a.patient.full_name, number: a.patient.number });
                  }}
                />
              ))}
            </ListPanel>
          )}

          <div style={{ marginTop: 18 }}>
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
                <Empty art="calendar" title="No appointments today">
                  The timeline fills in as visits are booked.
                </Empty>
              ) : (
                <DayTimeline
                  appointments={today.appointments}
                  asOf={today.as_of}
                  timeZone={timeZone}
                  nextId={nextUp?.id}
                  waitingMinutes={(a) => waitingMinutes(a, today.as_of)}
                  onOpen={(a) => {
                    peek({ id: a.patient.id, name: a.patient.full_name, number: a.patient.number });
                  }}
                />
              )}
            </MkCard>
          </div>
        </div>

        <div className="mk-today-side">
          <SectionHeader title="Alerts" />
          <AttentionSection items={today.attention} lowStock={today.low_stock ?? []} appointments={today.appointments} timeZone={timeZone} />

          <SectionHeader title="Chair status" />
          <MkCard>
            <ChairStatus chairs={today.chairs} timeZone={timeZone} />
          </MkCard>

          <div className="mk-stack" style={{ marginTop: 18 }}>
            <MkCard title="Appointments by hour" hint="Booked vs completed · hover for detail">
              {hours.length === 0 ? <Empty art="chart" title="No appointments today" /> : <Bars data={hours} summary="Appointments booked in each hour today" />}
            </MkCard>
            <MkCard
              title="Recent patients"
              hint="Latest arrivals today"
              action={
                can("patients.read") ? (
                  <Link to="/patients" className="mk-link">
                    View all
                  </Link>
                ) : undefined
              }
            >
              <RecentPatients tokens={today.recent_patients} appointments={today.appointments} pending={pendingItems} />
            </MkCard>
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
            <MkCard title="Team today" hint={`On duty · ${String(today.team.length)} ${today.team.length === 1 ? "doctor" : "doctors"}${staffOthers === 0 ? "" : ` · ${String(staffOthers)} staff`}`}>
              <TeamToday team={today.team} staff={staff.data?.members ?? []} />
            </MkCard>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * The hero: the clinician's next (or current) consultation with Open patient record, or the front
 * desk's next arrival with Check in. The ring shows the day's completed visits.
 */
function NextCard({ target, frontDesk, current, today, timeZone }: { target: TodayAppointment | undefined; frontDesk: boolean; current: boolean; today: Today; timeZone: string }) {
  const { can } = useClinic();
  const ring = (
    <ProgressRing
      value={today.counts.done}
      total={today.counts.total}
      caption="completed"
      label={`${String(today.counts.done)} of ${String(today.counts.total)} appointments completed`}
    />
  );
  if (target === undefined) {
    return (
      <HeroCard
        label={frontDesk ? "Next arrival" : "Next consultation"}
        eyebrow={frontDesk ? "Next arrival" : "Next consultation"}
        title={today.counts.total === 0 ? "No appointments booked today" : "Nobody else is booked today"}
        detail="Walk-ins can be added from the queue."
        ring={ring}
        action={
          <Link to="/queue" className="mk-btn mk-btn-ghost">
            <ListOrdered aria-hidden="true" /> Open queue
          </Link>
        }
      />
    );
  }
  const step = nextAction(target.status);
  return (
    <HeroCard
      label={frontDesk ? "Next arrival" : current ? "Current consultation" : "Next consultation"}
      eyebrow={`${frontDesk ? "Next arrival" : current ? "Now in clinic" : "Next consultation"} · ${formatTime(target.starts_at, timeZone)}`}
      title={target.patient.full_name}
      detail={[target.reason, target.room, target.practitioner.display_name].filter((part) => part != null && part !== "").join(" · ")}
      meta={`${target.patient.number} · ${APPOINTMENT_CHIP[target.status].label}`}
      ring={ring}
      action={
        <>
          {step !== undefined && can("appointments.write") ? <AppointmentActionButton appointment={target} /> : null}
          {can("patients.read") ? (
            <Link to={patientPath(target.patient)} className={step !== undefined && can("appointments.write") ? "mk-btn mk-btn-ghost" : "mk-btn mk-btn-primary"}>
              <ArrowUpRight aria-hidden="true" /> Open patient record
            </Link>
          ) : null}
        </>
      }
    />
  );
}

/** Whether a phone number from the API is a real, dialable one (without `patients.contact` it arrives masked). */
function dialable(phone: string | null | undefined): string | undefined {
  const digits = (phone ?? "").replace(/[\s-]/g, "");
  return /^\+?\d{7,15}$/.test(digits) ? digits : undefined;
}

function AttentionSection({ items, lowStock, appointments, timeZone }: { items: readonly TodayAttentionItem[]; lowStock: readonly LowStockAlert[]; appointments: Today["appointments"]; timeZone: string }) {
  if (items.length === 0 && lowStock.length === 0) {
    return (
      <div className="mk-list">
        <EmptyState compact art="clear" title="Nothing needs attention" description="Patients who are late, waiting too long, or items running low will show here." />
      </div>
    );
  }
  return (
    <div>
      {items.map((item, index) => (
        <AttentionRow
          key={item.appointment_id ?? item.queue_token_id ?? `attention-${String(index)}`}
          item={item}
          appointment={appointments.find((a) => a.id === item.appointment_id)}
          timeZone={timeZone}
        />
      ))}
      {lowStock.slice(0, 3).map((alert) => (
        <AlertBanner
          key={alert.item_id}
          tone="info"
          action={
            <Link to="/stock" className="mk-link">
              Open stock
            </Link>
          }
        >
          <b>{alert.name}</b> is running low: {alert.on_hand} {alert.unit} left, reorder at {alert.reorder_level}
        </AlertBanner>
      ))}
    </div>
  );
}

function plural(count: number, one: string, many: string): string {
  return `${String(count)} ${count === 1 ? one : many}`;
}

/** One alert in plain words, with the actions that settle it. */
function AttentionRow({ item, appointment, timeZone }: { item: TodayAttentionItem; appointment: TodayAppointment | undefined; timeZone: string }) {
  const { can } = useClinic();
  const toast = useToast();
  const setStatus = useSetAppointmentStatus();
  const readable = can("patients.read");
  const patient = usePatient(item.kind === "late_arrival" && readable ? item.patient.id : undefined);
  const phone = dialable(patient.data?.phone);
  const name = item.patient.full_name;
  const settle = (status: "arrived" | "no_show", done: string) => {
    if (appointment === undefined) {
      return;
    }
    setStatus.mutate(
      { id: appointment.id, change: { status } },
      {
        onSuccess: () => {
          toast.show({ title: done, tone: "success" });
        },
        onError: (thrown) => {
          toast.show({ title: apiErrorOf(thrown)?.message ?? "Couldn't update the appointment. Please try again.", tone: "danger" });
        },
      },
    );
  };
  if (item.kind === "long_wait") {
    return (
      <AlertBanner
        tone="danger"
        action={
          readable ? (
            <Link to={patientPath(item.patient)} className="mk-link">
              Open record
            </Link>
          ) : undefined
        }
      >
        <b>{name}</b> has been waiting {plural(item.minutes, "minute", "minutes")}
      </AlertBanner>
    );
  }
  const slot = appointment === undefined ? "" : ` — appointment ${formatTime(appointment.starts_at, timeZone)},`;
  const canWrite = can("appointments.write") && appointment !== undefined && (appointment.status === "booked" || appointment.status === "confirmed");
  return (
    <AlertBanner
      tone="warn"
      action={
        <span className="mk-alert-actions">
          {canWrite ? (
            <>
              <button
                type="button"
                className="mk-link"
                disabled={setStatus.isPending}
                onClick={() => {
                  settle("arrived", `${name} marked as arrived`);
                }}
              >
                Mark arrived
              </button>
              <button
                type="button"
                className="mk-link"
                disabled={setStatus.isPending}
                onClick={() => {
                  settle("no_show", `${name} marked as no-show`);
                }}
              >
                No-show
              </button>
            </>
          ) : null}
          {phone === undefined ? null : (
            <a className="mk-link" href={`tel:${phone}`} aria-label={`Call ${name}`}>
              Call
            </a>
          )}
        </span>
      }
    >
      <b>{name}</b> hasn&apos;t arrived{slot} {item.minutes} min late
    </AlertBanner>
  );
}

function ChairStatus({ chairs, timeZone }: { chairs: readonly TodayChair[]; timeZone: string }) {
  if (chairs.length === 0) {
    return (
      <Empty
        art="queue"
        title="No chairs set up yet"
        action={
          <Link to="/settings" className="mk-btn mk-btn-ghost">
            Add chairs in Settings
          </Link>
        }
      >
        Chair status shows live once chairs are added.
      </Empty>
    );
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
    return <Empty art="queue" title="Nobody has come in yet">Patients who arrive today will show here.</Empty>;
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
                  <StatusChip tone={t.status === "done" ? "done" : t.status === "in_chair" ? "ready" : t.status === "left" ? "done" : "waiting"}>
                    {t.status === "done" ? "Done" : t.status === "in_chair" ? "In chair" : t.status === "left" ? "Left" : "Waiting"}
                  </StatusChip>
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
    return <Empty art="chart" title="No bills issued this month">The revenue mix appears once bills are issued.</Empty>;
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
    return <Empty art="clear" title="Nothing pending">Every issued bill is paid in full.</Empty>;
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
                  <StatusChip tone={i.paid_paise > 0 ? "confirmed" : "waiting"}>{i.paid_paise > 0 ? "Partial" : "Due"}</StatusChip>
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

/** A name without a leading "Dr", lower-cased: "Dr. Asha Kulkarni" and "Asha Kulkarni" are one person. */
const personKey = (name: string) => name.trim().replace(/^dr\.?\s+/i, "").toLowerCase();

/** Active staff who are not already on the team: matched by membership, or by name when a doctor has none. */
export function staffBesideTeam<M extends { id: string; display_name: string; status: string }>(
  team: readonly { member_id?: string | null; practitioner: { display_name: string } }[],
  staff: readonly M[],
): M[] {
  const members = new Set(team.flatMap((t) => (t.member_id == null ? [] : [t.member_id])));
  const names = new Set(team.map((t) => personKey(t.practitioner.display_name)));
  return staff.filter((m) => m.status === "active" && !members.has(m.id) && !names.has(personKey(m.display_name)));
}

/** Who is on duty: the doctors (from today's schedule) and, for those who may see them, the clinic's other active staff. */
export function TeamToday({ team, staff }: { team: readonly TodayTeamMember[]; staff: readonly Member[] }) {
  const others = staffBesideTeam(team, staff);
  if (team.length === 0 && others.length === 0) {
    return <Empty art="team" title="Team today isn't available yet">Shows once a doctor has working hours set for today.</Empty>;
  }
  return (
    <div className="mk-tablewrap">
      <table className="mk-table">
        <caption className="mk-sr">Team today</caption>
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">Role</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {team.map((t) => (
            <tr key={t.practitioner.id}>
              <th scope="row">
                <span className="mk-pname">
                  <MkAvatar name={t.practitioner.display_name} />
                  {t.practitioner.display_name}
                </span>
              </th>
              <td>
                {t.specialty ?? "Doctor"} · {t.appointments} {t.appointments === 1 ? "visit" : "visits"}
              </td>
              <td>
                <StatusChip tone={t.on_leave ? "waiting" : "ready"}>{t.on_leave ? "On leave" : "In"}</StatusChip>
              </td>
            </tr>
          ))}
          {others.map((m) => (
            <tr key={m.id}>
              <th scope="row">
                <span className="mk-pname">
                  <MkAvatar name={m.display_name} />
                  {m.display_name}
                </span>
              </th>
              <td>{m.role_name}</td>
              <td>
                <StatusChip tone="brand">Active</StatusChip>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
