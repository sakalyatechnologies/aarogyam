import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

import { todayResponse, type ApiClient, type Today } from "@aarogyam/api-client";

import { ClinicProvider, useClinic } from "../../../clinic.js";
import { InertPeekProvider } from "../../../layout/peek.js";

/** A well-formed, obviously made-up id: the API's schemas want UUIDs. */
const uid = (group: number, n: number) => `5a5a5a5a-0000-4000-8000-${String(group).padStart(6, "0")}${String(n).padStart(6, "0")}`;
const [DOCTOR, PATIENT, APPT, ROOM] = [1, 2, 3, 4];

const doctor = (id: string, name: string, color: string) => ({ id, display_name: name, calendar_color: color });
const DR_RAO = doctor(uid(DOCTOR, 1), "Dr. Rao", "#0F766E");
const DR_IYER = doctor(uid(DOCTOR, 2), "Dr. Iyer", "#B45309");

const patient = (n: number, name: string, sex: "female" | "male") => ({
  id: uid(PATIENT, n),
  number: `P-${String(1000 + n)}`,
  full_name: name,
  sex,
  age_years: 20 + n * 7,
  registration_incomplete: false,
});
const PATIENTS = [
  patient(1, "Meera Kulkarni", "female"),
  patient(2, "Arjun Nair", "male"),
  patient(3, "Sana Sheikh", "female"),
  patient(4, "Vikram Desai", "male"),
  patient(5, "Lata Menon", "female"),
  patient(6, "Rohan Pillai", "male"),
];

/**
 * A made-up clinic day for the setup's preview, so a brand-new clinic with nothing booked still sees what each layout
 * looks like. Plain, believable numbers and invented names; nothing here is real data.
 */
export function sampleToday(now: Date = new Date()): Today {
  const day = now.toISOString().slice(0, 10);
  const at = (hour: number, minute = 0) => `${day}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00Z`;
  const statuses = ["completed", "in_chair", "arrived", "confirmed", "booked", "booked"] as const;
  const kinds = ["follow_up", "procedure", "new", "follow_up", "new", "follow_up"] as const;
  const reasons = ["Check-up", "Root canal", "Consultation", "Review", "Consultation", "Scaling"];
  const appointments = PATIENTS.map((p, index) => {
    const start = 4 + index;
    return {
      row_version: 1,
      id: uid(APPT, index),
      branch_id: uid(9, 1),
      starts_at: at(start, 30),
      ends_at: at(start + 1, 0),
      status: statuses[index],
      kind: kinds[index],
      source: "front_desk",
      reason: reasons[index],
      notes: null,
      has_notes: false,
      room: index % 2 === 0 ? "Chair 1" : "Chair 2",
      room_id: uid(ROOM, index % 2),
      patient: p,
      practitioner: index % 2 === 0 ? DR_RAO : DR_IYER,
      arrived_at: index < 3 ? at(start, 20) : null,
      seated_at: index < 2 ? at(start, 35) : null,
      completed_at: index === 0 ? at(start, 55) : null,
      cancel_reason: null,
      token_number: index + 1,
    };
  });
  const sample = {
    date: day,
    as_of: at(8, 40),
    counts: { total: 6, booked: 2, arrived: 1, in_chair: 1, done: 1, cancelled: 0, no_shows: 0, waiting: 1, called: 0, ready_to_bill: 1 },
    appointments,
    by_hour: [4, 5, 6, 7, 8, 9, 10, 11].map((h, i) => ({ hour: h + 5, booked: [1, 2, 3, 2, 1, 2, 1, 1][i] ?? 0, completed: i < 2 ? 1 : 0 })),
    chairs: [
      { room_id: uid(ROOM, 0), name: "Chair 1", kind: "chair", status: "in_use", current: { appointment_id: uid(APPT, 1), starts_at: at(5, 30), ends_at: at(6, 0), status: "in_chair", patient: PATIENTS[1], practitioner: DR_IYER }, next: null },
      { room_id: uid(ROOM, 1), name: "Chair 2", kind: "chair", status: "free", current: null, next: null },
    ],
    attention: [{ kind: "long_wait", message: "Waiting 25 minutes", minutes: 25, patient: { id: PATIENTS[2]?.id, number: PATIENTS[2]?.number, full_name: PATIENTS[2]?.full_name }, appointment_id: uid(APPT, 2), queue_token_id: null }],
    recent_patients: [],
    team: [
      { practitioner: DR_RAO, member_id: null, specialty: "Dentistry", on_leave: false, appointments: 3, shifts: [{ starts: "09:00", ends: "17:00" }] },
      { practitioner: DR_IYER, member_id: null, specialty: "Orthodontics", on_leave: false, appointments: 3, shifts: [{ starts: "10:00", ends: "18:00" }] },
    ],
    low_stock: null,
    completed_visits: [
      { visit_id: uid(5, 1), number: "V-2001", appointment_id: uid(APPT, 0), patient: { id: PATIENTS[0]?.id, number: PATIENTS[0]?.number, full_name: PATIENTS[0]?.full_name }, clinician_id: DR_RAO.id, clinician_name: DR_RAO.display_name, started_at: at(4, 35), ended_at: at(4, 55), billed_paise: 120000, paid_paise: 120000 },
    ],
    money: { collected_paise: 480000, payments: 4, invoiced_paise: 720000, invoices: 5 },
  };
  // Parsing brands the ids and checks the literal against the API's own schema, so the sample can't drift from it.
  return todayResponse.parse(sample);
}

const SampleClientContext = createContext<QueryClient | null>(null);

/** Gives every sample board under it one shared cache, so six thumbnails and the big preview fetch nothing twice. */
export function SampleScope({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnWindowFocus: false } } }));
  return <SampleClientContext value={client}>{children}</SampleClientContext>;
}

function withSample(api: ApiClient): ApiClient {
  return {
    ...api,
    getToday: () => Promise.resolve({ ok: true, value: sampleToday() }),
    listOpenLabOrders: () => Promise.resolve({ ok: true, value: { items: [] } }),
    getMonthSummary: (month: string) => Promise.resolve({ ok: true, value: { month, days: [] } }),
  };
}

/** Draws its children, a Board, from the made-up clinic day instead of the clinic's real one. Needs a `SampleScope`. */
export function SampleData({ children }: { children: ReactNode }) {
  const client = useContext(SampleClientContext);
  const clinic = useClinic();
  const value = useMemo(() => ({ ...clinic, api: withSample(clinic.api) }), [clinic]);
  if (client === null) throw new Error("SampleData must be inside a SampleScope");
  return (
    <QueryClientProvider client={client}>
      <ClinicProvider value={value}>
        <InertPeekProvider>{children}</InertPeekProvider>
      </ClinicProvider>
    </QueryClientProvider>
  );
}
