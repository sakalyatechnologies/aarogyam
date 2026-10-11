import type { Today } from "@aarogyam/api-client";
import { formatTime } from "@aarogyam/app-kit";
import { Tag } from "@sakalya/ui";

import { MkAvatar, StatusChip } from "../../../components/mk/index.js";
import { SortHeader } from "../../../components/sort-header.js";
import { useSortable, type SortColumn } from "../../../components/use-sortable.js";
import { APPOINTMENT_CHIP } from "../../../lib/appointment-status.js";
import { displayName } from "../../../lib/patients.js";

type Appointment = Today["appointments"][number];

const KIND_LABEL: Readonly<Record<Appointment["kind"], string>> = { new: "New", follow_up: "Follow-up", procedure: "Procedure", emergency: "Emergency" };

const COLUMNS: readonly SortColumn<Appointment>[] = [
  { id: "time", kind: "date", value: (a) => a.starts_at },
  { id: "patient", kind: "text", value: (a) => a.patient.full_name },
  { id: "type", kind: "text", value: (a) => KIND_LABEL[a.kind] },
  { id: "visit", kind: "text", value: (a) => a.reason },
  { id: "chair", kind: "text", value: (a) => a.room },
  { id: "status", kind: "text", value: (a) => APPOINTMENT_CHIP[a.status].label },
];

/** The day's appointments as a table whose headers sort it. `rows` arrive in time order, which is the order when no header is active. */
export function AppointmentsTable({ rows, zone, onOpen }: { rows: readonly Appointment[]; zone: string; onOpen: (a: Appointment) => void }) {
  const sortable = useSortable(rows, COLUMNS);
  return (
    <div className="tv2-scroll">
      <table className="tv2-table">
        <caption className="tv2-sr">Appointments</caption>
        <thead>
          <tr>
            <SortHeader id="time" sortable={sortable}>Time</SortHeader>
            <SortHeader id="patient" sortable={sortable}>Patient</SortHeader>
            <SortHeader id="type" sortable={sortable} className="tv2-opt">Type</SortHeader>
            <SortHeader id="visit" sortable={sortable} className="tv2-opt2">Visit</SortHeader>
            <SortHeader id="chair" sortable={sortable} className="tv2-opt">Chair</SortHeader>
            <SortHeader id="status" sortable={sortable}>Status</SortHeader>
          </tr>
        </thead>
        <tbody>
          {sortable.rows.map((a) => (
            <tr key={a.id}>
              <td className="tv2-mono">{formatTime(a.starts_at, zone)}</td>
              <td>
                <button type="button" className="tv2-cell-btn" onClick={() => { onOpen(a); }}>
                  <MkAvatar name={a.patient.full_name} />
                  {displayName(a.patient.full_name)}
                </button>
              </td>
              <td className="tv2-opt">{a.kind === "new" ? <Tag tone="warning">New</Tag> : <Tag>{KIND_LABEL[a.kind]}</Tag>}</td>
              <td className="tv2-opt2">{a.reason ?? "—"}</td>
              <td className="tv2-opt">{a.room ?? "—"}</td>
              <td>
                <StatusChip tone={APPOINTMENT_CHIP[a.status].tone}>{APPOINTMENT_CHIP[a.status].label}</StatusChip>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
