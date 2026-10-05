import { Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";

import { apiErrorOf, type AppointmentStatus } from "@aarogyam/api-client";
import { ApiErrorNotice, useDocumentTitle } from "@aarogyam/app-kit";
import { EmptyState, Select, Skeleton } from "@sakalya/ui";

import { MkCard } from "../../components/mk/index.js";
import { useClinic } from "../../clinic.js";
import { gridHours, nowMinutes, placementOf } from "../../lib/time-grid.js";
import { addDays, addMonths, mondayOf, monthStartOf, monthWeeks, todayIn } from "../../lib/time.js";
import { formatTime } from "@aarogyam/app-kit";
import { useAppointments, usePractitioners, useRooms } from "../../queries.js";
import { AppointmentDialog } from "./appointment-dialog.js";
import { MonthView, type MonthItem } from "./month-view.js";
import { TimeGrid, type GridColumn, type GridEvent } from "./time-grid.js";
import { BookingDialog } from "./booking-dialog.js";

type View = "day" | "week" | "month";
type Lane = "chair" | "doctor";

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Mock-up chip colours by status: completed green, waiting amber, booked brand, new consult indigo. */
const CHIP: Readonly<Record<AppointmentStatus, string>> = {
  requested: "q",
  booked: "b",
  confirmed: "i",
  arrived: "a",
  in_chair: "b",
  completed: "g",
  cancelled: "n",
  no_show: "r",
};

/** The legend colour for an appointment: requested dashed, emergencies red, new consults indigo, else by status. */
function toneOf(a: { status: AppointmentStatus; kind: string }): string {
  return CHIP[a.status === "requested" ? "requested" : a.kind === "emergency" ? "no_show" : a.kind === "new" && a.status !== "completed" && a.status !== "arrived" ? "confirmed" : a.status];
}

/** `29 Sep`, or `5 Oct 2026` with the year. */
function shortDate(iso: string, withYear = false): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", ...(withYear ? { year: "numeric" } : {}), timeZone: "UTC" });
}

/** Book and see the schedule: a week at a glance, or one day by chair or by doctor. */
export function CalendarPage() {
  const { session, can } = useClinic();
  useDocumentTitle("Calendar", session.clinic.name);
  const timeZone = session.clinic.timezone;
  const today = todayIn(timeZone);
  const [searchParams, setSearchParams] = useSearchParams();
  const [anchor, setAnchor] = useState(() => searchParams.get("from") ?? today);
  // Phones start on the day view; a seven-column week does not fit there.
  const [view, setView] = useState<View>(() => (typeof window.matchMedia === "function" && window.matchMedia("(max-width: 640px)").matches ? "day" : "week"));
  const [lane, setLane] = useState<Lane>("chair");
  // `?patient=<id>` (Patient 360's Follow-up) prefills the booking form. The range sync below rewrites the URL, so keep it here.
  const [bookPatient, setBookPatient] = useState(() => searchParams.get("patient"));
  const [bookingOpen, setBookingOpen] = useState(searchParams.get("book") === "1");
  // The top bar's New appointment button arrives here as `?book=1`; open the form once per arrival.
  const bookParam = searchParams.get("book") === "1";
  const [bookSeen, setBookSeen] = useState(bookParam);
  if (bookParam !== bookSeen) {
    setBookSeen(bookParam);
    if (bookParam) setBookingOpen(true);
  }
  // The now-line follows the clock; a minute is fine-grained enough.
  const [clock, setClock] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => {
      setClock(new Date());
    }, 60_000);
    return () => {
      window.clearInterval(timer);
    };
  }, []);
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);

  const monthDays = view === "month" ? monthWeeks(anchor).flat() : [];
  const from = view === "week" ? mondayOf(anchor) : view === "month" ? (monthDays[0] ?? anchor) : anchor;
  const to = view === "week" ? addDays(from, 6) : view === "month" ? (monthDays.at(-1) ?? anchor) : anchor;
  // The range rides in the URL (ISO dates only, never patient data) so the view can be shared or reloaded.
  useEffect(() => {
    setSearchParams({ from, to }, { replace: true });
  }, [from, to, setSearchParams]);
  const appointments = useAppointments({ from, to });
  const rooms = useRooms();
  const practitioners = usePractitioners();
  const canWrite = can("appointments.write");

  const items = appointments.data?.items ?? [];
  const selected = items.find((a) => a.id === selectedId);

  const columns: GridColumn[] =
    view === "week"
      ? Array.from({ length: 7 }, (_, index) => {
          const date = addDays(from, index);
          return { id: date, label: WEEKDAY_LABELS[index] ?? "", dateLabel: date.slice(8, 10), current: date === today, showNow: date === today };
        })
      : (lane === "chair"
          ? (rooms.data?.items ?? []).map((room) => ({ id: room.id, label: room.name }))
          : (practitioners.data?.items ?? []).map((p) => ({ id: p.id, label: p.display_name }))
        ).map((c) => ({ ...c, showNow: anchor === today }));

  const placed = items
    .filter((a) => a.status !== "cancelled")
    .flatMap((a): { event: GridEvent; startMin: number; endMin: number }[] => {
      const place = placementOf(a.starts_at, a.ends_at, timeZone);
      const columnId = view === "week" ? place.date : lane === "chair" ? (a.room_id ?? "") : a.practitioner.id;
      if (view === "day" && columnId === "") {
        return [];
      }
      const time = formatTime(a.starts_at, timeZone);
      const detail = a.status === "requested" ? "Requested online" : view === "week" ? `${a.practitioner.display_name}${a.room == null ? "" : ` · ${a.room}`}` : (a.room ?? a.practitioner.display_name);
      return [
        {
          startMin: place.startMin,
          endMin: place.endMin,
          event: {
            id: a.id,
            columnId,
            startMin: place.startMin,
            endMin: place.endMin,
            title: `${a.status === "requested" ? "? " : ""}${a.patient.full_name}`,
            subtitle: `${time} · ${detail}`,
            tone: toneOf(a),
            label: `${a.status === "requested" ? "Requested: " : ""}${a.patient.full_name}, ${a.reason ?? "Consultation"} at ${time}, ${detail}`,
          },
        },
      ];
    });
  const monthItems: MonthItem[] = items
    .filter((a) => a.status !== "cancelled")
    .map((a) => {
      const place = placementOf(a.starts_at, a.ends_at, timeZone);
      return { id: a.id, date: place.date, startMin: place.startMin, tone: toneOf(a), label: `${a.status === "requested" ? "? " : ""}${formatTime(a.starts_at, timeZone).replace(/ ?[ap]m$/i, "")} ${a.patient.full_name}` };
    });
  const events = placed.map((p) => p.event);
  const hours = gridHours(placed);
  const nowOnClinicClock = nowMinutes(clock, timeZone);

  const stepBy = view === "week" ? 7 : 1;
  const rangeLabel = view === "month" ? new Date(`${monthStartOf(anchor)}T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }) : view === "week" ? `${shortDate(from)} – ${shortDate(to, true)}` : shortDate(from, true);

  return (
    <div className="mk-panel">
      <h1 className="mk-sr">Calendar</h1>
      <div className="mk-ptools">
        <button
          type="button"
          className="mk-btn mk-btn-ghost"
          aria-label="Previous"
          onClick={() => {
            setAnchor((prev) => (view === "month" ? addMonths(prev, -1) : addDays(prev, -stepBy)));
          }}
        >
          ‹
        </button>
        <b style={{ fontSize: 15 }}>{rangeLabel}</b>
        <button
          type="button"
          className="mk-btn mk-btn-ghost"
          aria-label="Next"
          onClick={() => {
            setAnchor((prev) => (view === "month" ? addMonths(prev, 1) : addDays(prev, stepBy)));
          }}
        >
          ›
        </button>
        <button
          type="button"
          className="mk-chipf"
          onClick={() => {
            setAnchor(today);
          }}
        >
          Today
        </button>
        <span role="group" aria-label="View" style={{ display: "inline-flex", gap: 6, marginLeft: 8 }}>
          {(["day", "week", "month"] as const).map((v) => (
            <button
              key={v}
              type="button"
              className="mk-chipf"
              aria-pressed={view === v}
              onClick={() => {
                setView(v);
              }}
            >
              {v === "day" ? "Day" : v === "week" ? "Week" : "Month"}
            </button>
          ))}
        </span>
        {view === "day" ? (
          <input
            type="date"
            className="mk-chipf"
            aria-label="Pick a day"
            value={anchor}
            onChange={(event) => {
              if (event.target.value !== "") setAnchor(event.target.value);
            }}
          />
        ) : null}
        {view === "day" ? (
          <Select
            options={[
              { value: "chair", label: "By chair" },
              { value: "doctor", label: "By doctor" },
            ]}
            value={lane}
            onValueChange={(value) => {
              setLane(value);
            }}
            className="max-w-40"
          />
        ) : null}
        {canWrite ? (
          <button
            type="button"
            className="mk-btn mk-btn-primary mk-spacer"
            onClick={() => {
              setBookingOpen(true);
            }}
          >
            <Plus aria-hidden="true" /> New appointment
          </button>
        ) : null}
      </div>
      <MkCard title={view === "week" ? "Week view" : view === "month" ? "Month view" : "Day view"} hint="Colour: completed · waiting · booked · new consult · dashed: awaiting your confirmation">
        {appointments.isPending ? (
          <Skeleton shape="block" />
        ) : appointments.isError ? (
          apiErrorOf(appointments.error)?.status === 404 ? (
            <EmptyState title="Appointments aren't connected yet" description="The schedule will appear here once the API serves appointments." />
          ) : (
            <ApiErrorNotice title="Couldn't load the schedule" error={appointments.error} onRetry={() => void appointments.refetch()} />
          )
        ) : view === "month" ? (
          <div className="mk-tablewrap">
            <MonthView
              month={anchor}
              today={today}
              items={monthItems}
              onSelect={setSelectedId}
              onOpenDay={(date) => {
                setAnchor(date);
                setView("day");
              }}
            />
          </div>
        ) : columns.length === 0 ? (
          <EmptyState
            title={lane === "chair" ? "No chairs set up yet" : "No doctors set up yet"}
            description="Add them in Settings to see the schedule here."
          />
        ) : (
          <TimeGrid
            columns={columns}
            events={events}
            startHour={hours.start}
            endHour={hours.end}
            nowMinute={nowOnClinicClock.minutes}
            summary={`Appointments from ${from} to ${to}`}
            onSelect={setSelectedId}
          />
        )}
      </MkCard>

      <BookingDialog
        open={bookingOpen}
        onOpenChange={(open) => {
          setBookingOpen(open);
          if (!open) setBookPatient(null);
        }}
        timeZone={timeZone}
        rooms={rooms.data?.items ?? []}
        practitioners={practitioners.data?.items ?? []}
        defaultDate={anchor}
        patientParam={bookPatient}
      />
      <AppointmentDialog
        appointment={selected}
        onOpenChange={(open) => {
          if (!open) setSelectedId(undefined);
        }}
        timeZone={timeZone}
        rooms={rooms.data?.items ?? []}
        practitioners={practitioners.data?.items ?? []}
        canWrite={canWrite}
      />
    </div>
  );
}
