import {
  AlarmClockPlus,
  Armchair,
  CalendarDays,
  CheckCircle2,
  Clock3,
  IndianRupee,
  PieChart,
  Play,
  ReceiptText,
  UsersRound,
  XCircle,
} from "lucide-react";
import type { ReactNode } from "react";

import { apiErrorOf, type AppointmentStatus, type Today } from "@aarogyam/api-client";
import { ApiErrorNotice, formatTime, useDocumentTitle } from "@aarogyam/app-kit";
import {
  AttentionList,
  Avatar,
  BarChart,
  Button,
  Card,
  DataTable,
  EmptyState,
  Link,
  PageHeader,
  Pill,
  PersonList,
  Skeleton,
  StatCard,
  Timeline,
  type AttentionItem as AttentionRowItem,
  type DataTableColumn,
  type Status,
} from "@sakalya/ui";

import { useClinic } from "../../clinic.js";
import { ageSex, patientPath } from "../../lib/patients.js";
import { useToday } from "../../queries.js";

const MINUTE = 60_000;

type TodayAppointment = Today["appointments"][number];
type TodayAttentionItem = Today["attention"][number];
type TodayChair = Today["chairs"][number];
type TodayTeamMember = Today["team"][number];
type TodayQueueToken = Today["recent_patients"][number];

function waitingMinutes(appointment: TodayAppointment, asOf: string): number {
  return appointment.arrived_at == null ? 0 : Math.max(0, Math.round((Date.parse(asOf) - Date.parse(appointment.arrived_at)) / MINUTE));
}

function statusOf(appointment: TodayAppointment, asOf: string): Status {
  const icon = (node: ReactNode) => node;
  const labels: Readonly<Record<AppointmentStatus, Status>> = {
    booked: { label: "Booked", tone: "neutral" },
    confirmed: { label: "Confirmed", tone: "info" },
    arrived: { label: `Waiting ${String(waitingMinutes(appointment, asOf))} min`, tone: "warning", icon: icon(<Clock3 className="size-3.5" />) },
    in_chair: { label: "In the chair", tone: "primary", icon: icon(<Armchair className="size-3.5" />) },
    completed: { label: "Completed", tone: "success", icon: icon(<CheckCircle2 className="size-3.5" />) },
    cancelled: { label: "Cancelled", tone: "neutral", icon: icon(<XCircle className="size-3.5" />) },
    no_show: { label: "No-show", tone: "danger" },
  };
  return labels[appointment.status];
}

/** Today: who is in the chair now, who is waiting, who is next, and the day's numbers. */
export function TodayPage() {
  const { session, can } = useClinic();
  useDocumentTitle("Today", session.clinic.name);
  const today = useToday();
  return (
    <>
      <PageHeader title={`Hello, ${session.user.display_name}`} subtitle={`Here's today at ${session.clinic.name}.`} />
      {today.isPending ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4" role="status" aria-label="Loading today">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} shape="block" />
          ))}
        </div>
      ) : today.isError && apiErrorOf(today.error)?.status === 404 ? (
        <EmptyState
          title="Appointments aren't connected yet"
          description="Today's schedule and queue appear here once the API serves appointments. Patients work already."
          action={<Link href="/patients" className="text-sm font-semibold text-primary-text hover:underline">Go to patients</Link>}
        />
      ) : today.isError ? (
        <ApiErrorNotice title="Couldn't load today" error={today.error} onRetry={() => void today.refetch()} />
      ) : (
        <TodayBody today={today.data} timeZone={session.clinic.timezone} showMoney={can("finance.view")} />
      )}
    </>
  );
}

function TodayBody({ today, timeZone, showMoney }: { today: Today; timeZone: string; showMoney: boolean }) {
  const booked = today.appointments.filter((a) => a.status !== "cancelled");
  const waiting = booked.filter((a) => a.status === "arrived").sort((a, b) => (a.arrived_at ?? "").localeCompare(b.arrived_at ?? ""));
  const upcoming = booked.filter((a) => a.status === "booked" || a.status === "confirmed");
  const now = booked.find((a) => a.status === "in_chair") ?? waiting[0];
  const next = [...waiting.filter((a) => a !== now), ...upcoming].slice(0, 3);
  const hours = today.by_hour.map((bar) => ({
    label: `${String(bar.hour > 12 ? bar.hour - 12 : bar.hour === 0 ? 12 : bar.hour)} ${bar.hour >= 12 ? "pm" : "am"}`,
    total: bar.booked,
    part: bar.completed,
  }));

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Today's appointments"
          value={String(today.counts.total)}
          icon={<CalendarDays className="size-7" />}
          footer={
            <p className="text-xs font-semibold text-muted">
              {today.counts.done} completed · {today.counts.in_chair} in the chair · {today.counts.booked} upcoming
            </p>
          }
        />
        <StatCard
          label="Patients waiting"
          value={String(today.counts.waiting)}
          tone={today.counts.waiting > 0 ? "warning" : "primary"}
          icon={<UsersRound className="size-7" />}
          footer={
            waiting.length === 0 ? undefined : (
              <div className="flex flex-col items-start gap-1.5">
                {waiting.map((a) => (
                  <Pill key={a.id} tone="warning" icon={<Clock3 className="size-3.5" />}>
                    {a.patient.number} · {waitingMinutes(a, today.as_of)} min
                  </Pill>
                ))}
              </div>
            )
          }
        />
        {showMoney ? (
          <>
            <StatCard
              label="Today's collection"
              value="—"
              tone="neutral"
              icon={<IndianRupee className="size-7" />}
              footer={<p className="text-xs text-muted">Arrives with billing (M5)</p>}
            />
            <StatCard
              label="Pending dues"
              value="—"
              tone="neutral"
              icon={<ReceiptText className="size-7" />}
              footer={<p className="text-xs text-muted">Arrives with billing (M5)</p>}
            />
          </>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-4">
          <Card title="Now">
            {now === undefined ? (
              <EmptyState title="Nobody is waiting" description="New arrivals show here." icon={null} />
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="min-w-0">
                  <Link href={patientPath(now.patient)} className="text-xl font-extrabold tracking-tight text-text hover:underline">
                    {now.patient.full_name}
                  </Link>
                  <p className="text-sm text-muted">
                    {now.patient.number} · {ageSex(now.patient.age_years, now.patient.sex)}
                  </p>
                  <p className="mt-2 text-sm font-semibold text-text">{now.reason ?? "Consultation"}</p>
                  <p className="text-sm text-muted">
                    {now.status === "in_chair"
                      ? `In the chair since ${formatTime(now.seated_at ?? now.starts_at, timeZone)}`
                      : `Waiting ${String(waitingMinutes(now, today.as_of))} min`}{" "}
                    · {now.room ?? "No room"} · {now.practitioner.display_name}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <Button icon={<Play aria-hidden="true" className="size-4" />} disabled aria-describedby="start-note">
                    Start consultation
                  </Button>
                  <p id="start-note" className="text-xs text-muted">
                    Arrives with visits
                  </p>
                </div>
              </div>
            )}
          </Card>
          <Card title="Today's schedule">
            {today.appointments.length === 0 ? (
              <EmptyState title="No appointments today" icon={null} />
            ) : (
              <Timeline
                items={today.appointments.map((a) => ({
                  id: a.id,
                  time: formatTime(a.starts_at, timeZone),
                  title: a.patient.full_name,
                  subtitle: `${a.patient.number} · ${ageSex(a.patient.age_years, a.patient.sex)}`,
                  detail: a.reason ?? "Consultation",
                  detailSub: `${a.room ?? "No room"} · ${a.practitioner.display_name}`,
                  status: statusOf(a, today.as_of),
                  current: a === now,
                }))}
              />
            )}
          </Card>
        </div>
        <div className="flex flex-col gap-4">
          <Card title="Up next">
            {next.length === 0 ? (
              <EmptyState title="Nobody else today" icon={null} />
            ) : (
              <PersonList
                items={next.map((a) => ({
                  id: a.id,
                  name: a.patient.full_name,
                  subtitle: `${formatTime(a.starts_at, timeZone)} · ${a.reason ?? "Consultation"}`,
                  status: statusOf(a, today.as_of),
                }))}
              />
            )}
          </Card>
          <Card title="Today by hour">
            {hours.length === 0 ? (
              <EmptyState title="No appointments today" icon={null} />
            ) : (
              <BarChart data={hours} totalLabel="Booked" partLabel="Completed" categoryLabel="Hour" summary="Appointments booked and completed in each hour today" />
            )}
          </Card>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Attention required">
          <AttentionSection items={today.attention} />
        </Card>
        <Card title="Chair status">
          <ChairStatusGrid chairs={today.chairs} timeZone={timeZone} />
        </Card>
      </div>

      <Card title="Recent patients">
        <RecentPatientsTable tokens={today.recent_patients} timeZone={timeZone} />
      </Card>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card title="Revenue mix">
          <EmptyState title="Revenue mix isn't available yet" description="Shows once collections reporting lands in M5." icon={<PieChart className="size-7" />} />
        </Card>
        <Card title="Pending payments">
          <EmptyState title="Pending payments aren't available yet" description="Shows once invoices land in M5." icon={<ReceiptText className="size-7" />} />
        </Card>
        <Card title="Team today">
          <TeamTodayTable team={today.team} />
        </Card>
      </div>
    </div>
  );
}

function AttentionSection({ items }: { items: readonly TodayAttentionItem[] }) {
  if (items.length === 0) {
    return <EmptyState title="Nothing needs attention" description="Late arrivals and long waits appear here." icon={null} />;
  }
  const rows: AttentionRowItem[] = items.map((item, index) => ({
    id: item.appointment_id ?? item.queue_token_id ?? `attention-${String(index)}`,
    title: item.patient.full_name,
    subtitle: item.message,
    tone: item.kind === "long_wait" ? "danger" : "warning",
    icon: item.kind === "long_wait" ? <AlarmClockPlus aria-hidden="true" className="size-4" /> : <Clock3 aria-hidden="true" className="size-4" />,
    href: patientPath(item.patient),
  }));
  return <AttentionList items={rows} />;
}

function ChairStatusGrid({ chairs, timeZone }: { chairs: readonly TodayChair[]; timeZone: string }) {
  if (chairs.length === 0) {
    return <EmptyState title="No chairs set up yet" description="Add chairs in Settings to see their status here." icon={<Armchair className="size-7" />} />;
  }
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {chairs.map((chair) => (
        <div key={chair.room_id} className="rounded-2xl border border-border p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-bold text-text">{chair.name}</p>
            <Pill tone={chair.status === "in_use" ? "primary" : "success"}>{chair.status === "in_use" ? "In use" : "Free"}</Pill>
          </div>
          {chair.current ? (
            <p className="mt-2 text-xs text-muted">
              <span className="font-semibold text-text">{chair.current.patient.full_name}</span> · {chair.current.practitioner.display_name} · since{" "}
              {formatTime(chair.current.starts_at, timeZone)}
            </p>
          ) : (
            <p className="mt-2 text-xs text-muted">Nobody in this chair.</p>
          )}
          {chair.next ? (
            <p className="mt-1 text-xs text-muted">
              Next: {chair.next.patient.full_name} at {formatTime(chair.next.starts_at, timeZone)}
            </p>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function RecentPatientsTable({ tokens, timeZone }: { tokens: readonly TodayQueueToken[]; timeZone: string }) {
  const columns: readonly DataTableColumn<TodayQueueToken>[] = [
    {
      id: "patient",
      header: "Patient",
      cell: (t) => (
        <Link href={patientPath(t.patient)} className="flex items-center gap-3 font-semibold text-text hover:underline">
          <Avatar name={t.patient.full_name} size="sm" />
          {t.patient.full_name}
        </Link>
      ),
    },
    { id: "token", header: "Token", cell: (t) => `#${String(t.token_number)}` },
    { id: "time", header: "Arrived", cell: (t) => formatTime(t.issued_at, timeZone) },
    {
      id: "status",
      header: "Status",
      cell: (t) => (
        <Pill tone={t.status === "done" ? "success" : t.status === "in_chair" ? "primary" : t.status === "left" ? "neutral" : "warning"}>
          {t.status === "done" ? "Completed" : t.status === "in_chair" ? "In the chair" : t.status === "left" ? "Left" : "Waiting"}
        </Pill>
      ),
    },
  ];
  return (
    <DataTable
      caption="Recent patients"
      columns={columns}
      rows={tokens}
      rowKey={(t) => t.id}
      pageSize={10}
      empty={{ title: "Nobody has come in yet", description: "Patients who arrive today will show here." }}
    />
  );
}

function TeamTodayTable({ team }: { team: readonly TodayTeamMember[] }) {
  const columns: readonly DataTableColumn<TodayTeamMember>[] = [
    { id: "name", header: "Doctor", cell: (t) => t.practitioner.display_name },
    { id: "shifts", header: "Shift", cell: (t) => t.shifts.map((s) => `${s.starts}–${s.ends}`).join(", ") },
    { id: "appointments", header: "Appointments", align: "end", cell: (t) => String(t.appointments) },
    {
      id: "status",
      header: "Status",
      cell: (t) => (t.on_leave ? <Pill tone="warning">On leave</Pill> : <Pill tone="success">Working</Pill>),
    },
  ];
  return (
    <DataTable
      caption="Team today"
      columns={columns}
      rows={team}
      rowKey={(t) => t.practitioner.id}
      empty={{ title: "Team today isn't available yet", description: "Shows once a doctor has working hours set for today." }}
    />
  );
}
