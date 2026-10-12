import { Activity, Armchair, CalendarDays, CircleCheck, Clock, CreditCard, FlaskConical, IndianRupee, UserPlus, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import type { OpenLabOrder, Today } from "@aarogyam/api-client";
import { formatRupees } from "@aarogyam/app-kit";

import { useClinic } from "../../../clinic.js";
import { displayName } from "../../../lib/patients.js";
import { useTodayMoney } from "../../billing/queries.js";
import { waitingMinutes } from "../today-page.js";
import { useBoard } from "./board-context.js";
import { allowed } from "./layout-model.js";
import { MoneyEye, useShowMoney } from "./money.js";
import { useDayToday, useOpenLabs } from "./queries.js";
import { firstWord } from "./seeing.js";
import { COPY } from "./copy.js";
import { Body, Empty, type WidgetProps } from "./widget-parts.js";

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

/** The tiles' own names, where the day-to-day word is clearer than the catalogue's. */
const METRIC_LABEL: Readonly<Record<string, string>> = {
  appointments: "Appointments today",
  waiting: "Waiting",
  collected: "Collected today",
  chairs_busy: "In chair now",
  lab_due: "Lab cases due",
};

/** Metrics that are money: hidden behind the eye until the person asks. */
const MONEY_METRICS: ReadonlySet<string> = new Set(["collected", "outstanding"]);

interface Tile {
  key: string;
  label: string;
  icon: LucideIcon;
  value: ReactNode;
  hint: ReactNode;
  money?: boolean;
}

type Lab = OpenLabOrder;

/** The open lab orders in the three words the front desk uses: at the lab, due today or late, and back and ready to fit. */
export function labBreakdown(orders: readonly Lab[], today: string): { sent: number; due: number; arrived: number } {
  return {
    sent: orders.filter((o) => o.pipeline_stage === "sent" || o.pipeline_stage === "in_progress").length,
    due: orders.filter((o) => o.late || o.due_on === today).length,
    arrived: orders.filter((o) => o.pipeline_stage === "ready_to_fit").length,
  };
}

function chairHint(today: Today): string {
  const busy = today.chairs.find((c) => c.status === "in_use");
  if (busy === undefined) return today.chairs.length === 0 ? COPY.noChairsSetUp : "All chairs free";
  const who = busy.current?.patient.full_name;
  return who === undefined ? busy.name : `${busy.name} · ${firstWord(displayName(who))}`;
}

function waitHint(today: Today): string {
  const waiting = today.appointments.filter((a) => a.status === "arrived");
  if (waiting.length === 0) return COPY.noOneWaiting;
  const total = waiting.reduce((sum, a) => sum + waitingMinutes(a, today.as_of), 0);
  return `Avg wait ${String(Math.round(total / waiting.length))} min`;
}

function KpiTile({ tile }: { tile: Tile }) {
  const [shown] = useShowMoney();
  const Icon = tile.icon;
  return (
    <li className="tv2-kpi" data-metric={tile.key}>
      <div className="tv2-kpi-top">
        <span className="tv2-kpi-ico" aria-hidden="true">
          <Icon className="size-4" />
        </span>
        {tile.money === true ? <MoneyEye what={tile.label.toLowerCase()} /> : null}
      </div>
      <p className="tv2-kpi-label">{tile.label}</p>
      <p className="tv2-kpi-value">{tile.money === true && !shown ? <>
          <span aria-hidden="true">₹•••••</span>
          <span className="tv2-sr">Hidden</span>
        </> : tile.value}</p>
      <p className="tv2-kpi-hint">{tile.money === true && !shown ? "Tap the eye to show" : tile.hint}</p>
    </li>
  );
}

/** The key-number tiles of the top strip. Money tiles stay hidden until the eye is pressed, and only members with `finance.view` get them. */
export function KpisWidget({ opts, catalogue, spec }: WidgetProps) {
  const { date } = useBoard();
  const { can } = useClinic();
  const day = useDayToday(date);
  const labs = useOpenLabs(can("labs.read"));
  const [shown] = useShowMoney();
  const money = useTodayMoney(can("finance.view") && shown);
  const wanted = Array.isArray(opts["metrics"]) ? opts["metrics"].filter((m): m is string => typeof m === "string") : [];
  // A number the member may not see is left out, not shown as a zero.
  const metrics = wanted.flatMap((key) => {
    const info = catalogue.metrics.find((m) => m.key === key);
    return info !== undefined && allowed(info.requires, can) ? [info] : [];
  });
  return (
    <Body query={day} label={spec.label} rows={2} empty={null}>
      {(today) => {
        if (metrics.length === 0) return <Empty title={COPY.noKeyNumbers} />;
        const toGo = Math.max(0, today.counts.total - today.counts.done - today.counts.cancelled - today.counts.no_shows);
        const tiles: Tile[] = [];
        for (const metric of metrics) {
          const base = { key: metric.key, label: METRIC_LABEL[metric.key] ?? metric.label, icon: METRIC_ICON[metric.key] ?? Activity, money: MONEY_METRICS.has(metric.key) };
          switch (metric.key) {
            case "appointments":
              tiles.push({ ...base, value: today.counts.total, hint: `${String(today.counts.done)} done · ${String(toGo)} to go` });
              break;
            case "completed":
              tiles.push({ ...base, value: today.counts.done, hint: `${String(toGo)} to go` });
              break;
            case "waiting":
              tiles.push({ ...base, value: today.counts.waiting, hint: waitHint(today) });
              break;
            case "new_patients":
              tiles.push({ ...base, value: today.appointments.filter((a) => a.kind === "new" && a.status !== "cancelled").length, hint: "First visits" });
              break;
            case "collected":
              if (today.money != null) tiles.push({ ...base, value: shown ? formatRupees(today.money.collected_paise) : "", hint: shown ? `${String(today.money.payments)} payments` : "" });
              break;
            case "outstanding":
              tiles.push({
                ...base,
                value: shown && money.data !== undefined ? formatRupees(money.data.pending_dues_paise) : "—",
                hint: shown && money.data !== undefined ? `${String(money.data.pending_dues_patients)} patients` : "",
              });
              break;
            case "chairs_busy":
              tiles.push({ ...base, value: today.chairs.filter((c) => c.status === "in_use").length, hint: chairHint(today) });
              break;
            case "lab_due": {
              if (labs.data === undefined) {
                tiles.push({ ...base, value: "—", hint: "" });
                break;
              }
              const { sent, due, arrived } = labBreakdown(labs.data.items, today.date);
              tiles.push({ ...base, value: due, hint: `${String(sent)} sent · ${String(due)} due · ${String(arrived)} arrived` });
              break;
            }
            default:
              break;
          }
        }
        return (
          <ul className="tv2-kpis" aria-label="Key numbers" data-count={tiles.length}>
            {tiles.map((tile) => (
              <KpiTile key={tile.key} tile={tile} />
            ))}
          </ul>
        );
      }}
    </Body>
  );
}
