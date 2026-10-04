import {
  Armchair,
  CalendarDays,
  CheckCircle2,
  CircleDot,
  Clock3,
  IndianRupee,
  PieChart,
  Play,
  ReceiptText,
  UsersRound,
  XCircle,
} from "lucide-react";
import type { ReactNode } from "react";

import { apiErrorOf, type AppointmentStatus, type Today, type TodayAppointment } from "@aarogyam/api-client";
import { ApiErrorNotice, formatRupees, formatTime, useDocumentTitle } from "@aarogyam/app-kit";
import {
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
  type DataTableColumn,
  type Status,
} from "@sakalya/ui";

import { useClinic } from "../../clinic.js";
import { ageSex, patientPath } from "../../lib/patients.js";
import { useToday } from "../../queries.js";

const MINUTE = 60_000;

function waitingMinutes(appointment: TodayAppointment, asOf: string): number {
  return appointment.arrived_at == null ? 0 : Math.max(0, Math.round((Date.parse(asOf) - Date.parse(appointment.arrived_at)) / MINUTE));
}

function statusOf(appointment: TodayAppointment, asOf: string): Status {
  const icon = (node: ReactNode) => node;
  const labels: Readonly<Record<AppointmentStatus, Status>> = {
    scheduled: { label: "Scheduled", tone: "neutral" },
    confirmed: { label: "Confirmed", tone: "info" },
    arrived: { label: `Waiting ${String(waitingMinutes(appointment, asOf))} min`, tone: "warning", icon: icon(<Clock3 className="size-3.5" />) },
    in_progress: { label: "In consultation", tone: "primary", icon: icon(<CircleDot className="size-3.5" />) },
    completed: { label: "Completed", tone: "success", icon: icon(<CheckCircle2 className="size-3.5" />) },
    cancelled: { label: "Cancelled", tone: "neutral", icon: icon(<XCircle className="size-3.5" />) },
    no_show: { label: "No-show", tone: "danger" },
  };
  return labels[appointment.status];
}

/** Today: who is in the chair now, who is waiting, who is next, and the day's numbers. */
export function TodayPage() {
  const { session } = useClinic();
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
        <TodayBody today={today.data} timeZone={session.clinic.timezone} />
      )}
    </>
  );
}

function TodayBody({ today, timeZone }: { today: Today; timeZone: string }) {
  const booked = today.appointments.filter((a) => a.status !== "cancelled");
  const done = booked.filter((a) => a.status === "completed");
  const waiting = booked.filter((a) => a.status === "arrived").sort((a, b) => (a.arrived_at ?? "").localeCompare(b.arrived_at ?? ""));
  const upcoming = booked.filter((a) => a.status === "scheduled" || a.status === "confirmed");
  const now = booked.find((a) => a.status === "in_progress") ?? waiting[0];
  const next = [...waiting.filter((a) => a !== now), ...upcoming].slice(0, 3);
  const hours = Array.from({ length: 10 }, (_, index) => 9 + index).map((hour) => {
    const inHour = booked.filter((a) => Number(new Intl.DateTimeFormat("en-IN", { hour: "numeric", hourCycle: "h23", timeZone }).format(new Date(a.starts_at))) === hour);
    return { label: `${String(hour > 12 ? hour - 12 : hour)} ${hour >= 12 ? "pm" : "am"}`, total: inHour.length, part: inHour.filter((a) => a.status === "completed").length };
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Today's appointments"
          value={String(booked.length)}
          icon={<CalendarDays className="size-7" />}
          footer={
            <p className="text-xs font-semibold text-muted">
              {done.length} completed · {waiting.length} waiting · {upcoming.length} upcoming
            </p>
          }
        />
        <StatCard
          label="Patients waiting"
          value={String(waiting.length)}
          tone={waiting.length > 0 ? "warning" : "primary"}
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
        {today.money == null ? null : (
          <>
            <StatCard label="Today's collection" value={formatRupees(today.money.collected_paise)} tone="success" icon={<IndianRupee className="size-7" />} />
            <StatCard
              label="Pending dues"
              value={formatRupees(today.money.pending_dues_paise)}
              tone="danger"
              icon={<ReceiptText className="size-7" />}
              footer={<p className="text-xs text-muted">From {today.money.pending_dues_patients} patients</p>}
            />
          </>
        )}
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
                    {now.status === "in_progress"
                      ? `In the chair since ${formatTime(now.arrived_at ?? now.starts_at, timeZone)}`
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
            <BarChart data={hours} totalLabel="Booked" partLabel="Completed" categoryLabel="Hour" summary="Appointments booked and completed in each hour today" />
          </Card>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Attention required">
          <EmptyState
            title="Nothing needs attention"
            description="Allergy flags, recalls and unpaid invoices will appear here once M4 and M5 land."
            icon={null}
          />
        </Card>
        <Card title="Chair status">
          <EmptyState title="Chair status isn't available yet" description="Needs a small shape change to appointments, planned for M3." icon={<Armchair className="size-7" />} />
        </Card>
      </div>

      <Card title="Recent patients">
        <DataTable
          caption="Recent patients"
          columns={
            [
              {
                id: "patient",
                header: "Patient",
                cell: (a) => (
                  <Link href={patientPath(a.patient)} className="flex items-center gap-3 font-semibold text-text hover:underline">
                    <Avatar name={a.patient.full_name} size="sm" />
                    {a.patient.full_name}
                  </Link>
                ),
              },
              { id: "time", header: "Seen at", cell: (a) => formatTime(a.starts_at, timeZone) },
              { id: "reason", header: "Reason", cell: (a) => a.reason ?? "Consultation" },
              { id: "status", header: "Status", cell: () => <Pill tone="success">Completed</Pill> },
            ] satisfies DataTableColumn<TodayAppointment>[]
          }
          rows={done}
          rowKey={(a) => a.id}
          pageSize={8}
          empty={{ title: "No completed visits yet", description: "Patients seen today will show here." }}
        />
      </Card>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card title="Revenue mix">
          <EmptyState title="Revenue mix isn't available yet" description="Shows once collections reporting lands in M5." icon={<PieChart className="size-7" />} />
        </Card>
        <Card title="Pending payments">
          <EmptyState title="Pending payments aren't available yet" description="Shows once invoices land in M5." icon={<ReceiptText className="size-7" />} />
        </Card>
        <Card title="Team today">
          <EmptyState title="Team today isn't available yet" description="Shows once working hours and shifts land in M3." icon={<UsersRound className="size-7" />} />
        </Card>
      </div>
    </div>
  );
}
