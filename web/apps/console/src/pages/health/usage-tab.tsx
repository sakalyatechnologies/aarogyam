/** The Usage tab: visits and timings per day, people signed in by role, each clinic, and onboarding. */

import { CalendarCheck, Building2, UserX, Users } from "lucide-react";

import type { ClinicUsage, MetricsRange, OnboardingClinic, UsageInsights } from "@aarogyam/api-client";
import { ApiErrorNotice, formatDate, formatNumber } from "@aarogyam/app-kit";
import { Card, CardLink, DataTable, StatCard, type DataTableColumn, type LineSeries } from "@sakalya/ui";

import { useUsageInsights } from "../../api.js";
import { ChartCard, LoadingCharts, RANGE_WORDS, one, xAxis } from "./insight-parts.js";
import { dayFormatter, dayTime, funnelCounts } from "./metrics-view.js";

const TITLES = ["Visits and bookings", "People signed in", "Typical timings", "Signed in by role"] as const;

const ROLE_WORDS: Readonly<Record<string, string>> = {
  owner: "Owners",
  doctor: "Doctors",
  consultant: "Consultants",
  finance: "Finance",
  front_desk: "Front desk",
  assistant: "Assistants",
  custom: "Custom roles",
};
const roleWord = (key: string) => ROLE_WORDS[key] ?? key;
const ROLE_COLORS = ["var(--sk-chart-1)", "var(--sk-info)", "var(--sk-warning)", "var(--sk-chart-3)", "var(--sk-danger)", "var(--sk-success)"] as const;
const DASHES = [undefined, "7 4", "2 3", "10 3 2 3"] as const;

export function UsageTab({ range }: { range: MetricsRange }) {
  const usage = useUsageInsights(range);
  if (usage.isPending) {
    return <LoadingCharts titles={TITLES} label="Loading clinic usage" />;
  }
  if (usage.isError) {
    return <ApiErrorNotice title="Couldn't load clinic usage" error={usage.error} onRetry={() => void usage.refetch()} />;
  }
  return <UsageBody usage={usage.data} range={range} />;
}

const minutes = (value: number | null | undefined) => (value === null || value === undefined ? "—" : `${one.format(value)} min`);

function UsageBody({ usage, range }: { usage: UsageInsights; range: MetricsRange }) {
  const words = range === "7d" || range === "30d" ? RANGE_WORDS[range] : "yesterday";
  const days = usage.days;
  const visits = days.reduce((sum, day) => sum + day.visits, 0);
  const noShows = days.reduce((sum, day) => sum + day.no_shows, 0);
  const booked = days.reduce((sum, day) => sum + day.booked, 0);
  const latest = days.at(-1);
  const x = xAxis(days.map((day) => dayTime(day.day)), dayFormatter(), "Day", `No days recorded for ${words} yet: the outbox job writes each clinic's day shortly after its midnight.`);

  const roleKeys = [...new Set(usage.roles.map((row) => row.role_key))].sort();
  const roleTimes = [...new Set(usage.roles.map((row) => dayTime(row.day)))].sort((a, b) => a - b);
  const roleSeries = roleKeys.map((key, index): LineSeries => {
    const dash = DASHES[index % DASHES.length];
    const byDay = new Map(usage.roles.filter((row) => row.role_key === key).map((row) => [dayTime(row.day), row.members]));
    return {
      id: key,
      label: roleWord(key),
      values: roleTimes.map((time) => byDay.get(time) ?? null),
      color: ROLE_COLORS[index % ROLE_COLORS.length] ?? "var(--sk-chart-1)",
      ...(dash === undefined ? {} : { dash }),
    };
  });
  const roleAxis = xAxis(roleTimes, dayFormatter(), "Day", `Nobody signed in during ${words}, or no days recorded yet.`);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Visits" value={formatNumber(visits)} icon={<CalendarCheck className="size-7" />} footer={<p className="text-xs text-muted">Started {words}, all clinics</p>} />
        <StatCard
          label="No-shows"
          value={formatNumber(noShows)}
          tone="neutral"
          icon={<UserX className="size-7" />}
          footer={<p className="text-xs text-muted">{booked === 0 ? "No appointments booked" : `${one.format((noShows / booked) * 100)}% of ${formatNumber(booked)} booked`}</p>}
        />
        <StatCard
          label="People signed in"
          value={formatNumber(latest?.active_staff ?? 0)}
          tone="neutral"
          icon={<Users className="size-7" />}
          footer={<p className="text-xs text-muted">{latest === undefined ? "No day recorded yet" : `On ${formatDate(`${latest.day}T12:00:00Z`)}, any clinic, web or phone`}</p>}
        />
        <StatCard label="Clinics reporting" value={formatNumber(usage.clinics.length)} tone="neutral" icon={<Building2 className="size-7" />} footer={<p className="text-xs text-muted">With at least one recorded day</p>} />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <ChartCard
          {...x}
          title="Visits and bookings"
          note="Visits started, appointments booked for the day, and no-shows, all clinics together."
          yLabel="Per day"
          formatY={(value) => formatNumber(Math.round(value))}
          series={[
            { id: "visits", label: "Visits", values: days.map((day) => day.visits), color: "var(--sk-chart-1)" },
            { id: "booked", label: "Booked", values: days.map((day) => day.booked), color: "var(--sk-info)", dash: "7 4" },
            { id: "no-shows", label: "No-shows", values: days.map((day) => day.no_shows), color: "var(--sk-danger)", dash: "2 3" },
          ]}
          summary={`Visits, bookings and no-shows per day over ${words}.`}
        />
        <ChartCard
          {...x}
          title="People signed in"
          note="Staff with any sign-in activity that day; a person in two clinics, or on a phone, counts in each."
          yLabel="People"
          formatY={(value) => formatNumber(Math.round(value))}
          series={[{ id: "staff", label: "Signed in", values: days.map((day) => day.active_staff), color: "var(--sk-chart-1)" }]}
          summary={`People signed in per day over ${words}, all clinics together.`}
        />
        <ChartCard
          {...x}
          title="Typical timings"
          note="Medians in minutes, weighted by visits; a clinic-day with fewer than 5 visits is left out."
          yLabel="Minutes"
          formatY={(value) => one.format(value)}
          formatValue={(value) => `${one.format(value)} min`}
          series={[
            { id: "arrive", label: "Arrived → seated", values: days.map((day) => day.timings.arrive_to_seat_minutes), color: "var(--sk-warning)" },
            { id: "seat", label: "Seated → visit started", values: days.map((day) => day.timings.seat_to_start_minutes), color: "var(--sk-info)", dash: "7 4" },
            { id: "visit", label: "Visit length", values: days.map((day) => day.timings.visit_minutes), color: "var(--sk-chart-1)", dash: "2 3" },
            { id: "paid", label: "Visit ended → paid", values: days.map((day) => day.timings.end_to_paid_minutes), color: "var(--sk-success)", dash: "10 3 2 3" },
          ]}
          summary={`Typical minutes from arrival to payment per day over ${words}.`}
        />
        <ChartCard
          {...roleAxis}
          title="Signed in by role"
          note="People signed in per role across all clinics; no clinic is named here."
          yLabel="People"
          formatY={(value) => formatNumber(Math.round(value))}
          series={roleSeries}
          summary={`People signed in per role per day over ${words}, across all clinics.`}
        />
      </div>

      <Card title="Clinics">
        <p className="mb-2 text-xs text-muted">Totals {words}. Roles show only where 3 or more people in that role signed in on the latest day.</p>
        <DataTable
          caption="Clinic usage"
          columns={CLINIC_COLUMNS}
          rows={usage.clinics}
          rowKey={(row) => row.org_id}
          defaultSort={{ columnId: "visits", direction: "descending" }}
          pageSize={10}
          empty={{ title: "No days recorded yet", description: "The outbox job writes each clinic's day shortly after its midnight." }}
        />
      </Card>

      <OnboardingCard rows={usage.onboarding} />
    </div>
  );
}

const CLINIC_COLUMNS: readonly DataTableColumn<ClinicUsage>[] = [
  { id: "clinic", header: "Clinic", cell: (row) => <CardLink href={`/clinics/${row.org_id}`}>{row.name}</CardLink>, sortValue: (row) => row.name },
  { id: "visits", header: "Visits", align: "end", cell: (row) => formatNumber(row.visits), sortValue: (row) => row.visits },
  { id: "no-shows", header: "No-shows", align: "end", cell: (row) => formatNumber(row.no_shows), sortValue: (row) => row.no_shows },
  { id: "staff", header: "Signed in", align: "end", cell: (row) => formatNumber(row.active_staff), sortValue: (row) => row.active_staff },
  { id: "arrive", header: "Arrived → seated", align: "end", cell: (row) => minutes(row.timings.arrive_to_seat_minutes) },
  { id: "visit", header: "Visit length", align: "end", cell: (row) => minutes(row.timings.visit_minutes) },
  { id: "paid", header: "Ended → paid", align: "end", cell: (row) => minutes(row.timings.end_to_paid_minutes) },
  {
    id: "roles",
    header: "By role",
    cell: (row) => (row.roles.length === 0 ? "—" : row.roles.map((role) => `${roleWord(role.role_key)} ${String(role.members)}`).join(", ")),
  },
];

const when = (value: string | null | undefined) => (value === null || value === undefined ? "—" : formatDate(value));

const ONBOARDING_COLUMNS: readonly DataTableColumn<OnboardingClinic>[] = [
  { id: "clinic", header: "Clinic", cell: (row) => <CardLink href={`/clinics/${row.org_id}`}>{row.name}</CardLink>, sortValue: (row) => row.name },
  { id: "status", header: "Status", cell: (row) => row.status, sortValue: (row) => row.status },
  { id: "created", header: "Created", cell: (row) => when(row.created_at), sortValue: (row) => row.created_at },
  { id: "owner", header: "Owner joined", cell: (row) => when(row.owner_joined_at) },
  { id: "setup", header: "Setup", cell: (row) => (row.setup_completed_at === null || row.setup_completed_at === undefined ? `${String(row.setup_steps_done)} steps done` : `Done ${when(row.setup_completed_at)}`) },
  { id: "patient", header: "First patient", cell: (row) => when(row.first_patient_at) },
  { id: "visit", header: "First visit", cell: (row) => when(row.first_visit_at) },
  { id: "bill", header: "First bill", cell: (row) => when(row.first_bill_at) },
  { id: "busy", header: "Week with 5+ visits", cell: (row) => (row.first_busy_week === null ? "—" : formatDate(`${row.first_busy_week}T12:00:00Z`)) },
];

function OnboardingCard({ rows }: { rows: readonly OnboardingClinic[] }) {
  const funnel = funnelCounts(rows);
  return (
    <Card title="Onboarding">
      <p className="mb-3 text-xs text-muted">How far each clinic has come since it was created. Open a clinic for its details.</p>
      <ol className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7" aria-label="Onboarding funnel">
        {funnel.map((step) => (
          <li key={step.label} className="rounded-lg border border-border px-3 py-2">
            <p className="text-xs font-semibold text-muted">{step.label}</p>
            <p className="text-xl font-extrabold tracking-tight text-text">{formatNumber(step.count)}</p>
          </li>
        ))}
      </ol>
      <DataTable caption="Onboarding by clinic" columns={ONBOARDING_COLUMNS} rows={rows} rowKey={(row) => row.org_id} pageSize={10} empty={{ title: "No clinics yet" }} />
    </Card>
  );
}
