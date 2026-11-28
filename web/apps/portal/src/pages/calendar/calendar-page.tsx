import { Plus } from "lucide-react";
import { useEffect, useState } from "react";

import "./calendar.css";
import { Link, useNavigate, useSearchParams } from "react-router";

import { apiErrorOf, type AppointmentStatus, type CalendarWalkIn, type PractitionerId } from "@aarogyam/api-client";
import { ApiErrorNotice, useDocumentTitle } from "@aarogyam/app-kit";
import { Select } from "@sakalya/ui";

import { DatePicker } from "../../components/mk/date-picker.js";
import { MkCard, EmptyState, PageHeader } from "../../components/mk/index.js";
import { useClinic } from "../../clinic.js";
import { useNewLook } from "../../lib/new-look.js";
import { gridHours, nowMinutes, placementOf } from "../../lib/time-grid.js";
import { formatHm, shiftsOn } from "../../lib/slots.js";
import { addDays, addMonths, mondayOf, monthStartOf, monthWeeks, todayIn } from "../../lib/time.js";
import { formatTime } from "@aarogyam/app-kit";
import { useAppointments, usePractitioners, useRooms, useWalkIns, useWorkingHoursMany } from "../../queries.js";
import { useTimeOff } from "../../lib/time-off-queries.js";
import { awayOn, isAway } from "./away.js";
import { AppointmentDialog } from "./appointment-dialog.js";
import { MonthView, type MonthAway, type MonthItem } from "./month-view.js";
import { DOCTOR_TONES, TimeGrid, type BookSlot, type EventStatus, type GridColumn, type GridEvent } from "./time-grid.js";
import { BookingDialog } from "./booking-dialog.js";
import { visitKindLabel } from "./visit-kind-tag.js";
import { SkeletonRows } from "../../components/skeleton-rows.js";
import { COPY } from "../today/v2/copy.js";

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

/** The usual working day, shaded around in the time grid. */
const WORKING_MINUTES = { start: 9 * 60, end: 18 * 60 };

const LEGEND = [
  { tone: "g", label: "Completed" },
  { tone: "a", label: "Waiting" },
  { tone: "b", label: "Booked" },
  { tone: "i", label: "New consult" },
  { tone: "r", label: "Emergency or no-show" },
  { tone: "q", label: "Awaiting confirmation" },
] as const;

/** Colour key for the schedule cards; the classic look also lists the doctors (the New look's doctor chips carry their colours). */
function Legend({ doctors = [] }: { doctors?: readonly { id: string; name: string }[] }) {
  return (
    <ul className="mk-legend" aria-label="Colour key">
      {LEGEND.map((l) => (
        <li key={l.tone} className={`mk-legend-chip ${l.tone}`}>
          <span aria-hidden="true" />
          {l.label}
        </li>
      ))}
      {doctors.map((d, index) => (
        <li key={d.id} className="mk-legend-chip doc">
          <i className={`mk-docdot d${String(index % DOCTOR_TONES)}`} aria-hidden="true" />
          {d.name}
        </li>
      ))}
    </ul>
  );
}

/** The status icon an appointment wears: requests and emergencies are told apart from their plain status. */
function eventStatusOf(a: { status: AppointmentStatus; kind: string }): EventStatus {
  if (a.status === "requested") return "requested";
  if (a.kind === "emergency" && a.status !== "completed") return "emergency";
  return a.status === "cancelled" ? "booked" : a.status;
}

const STATUS_WORD: Readonly<Record<EventStatus, string>> = {
  requested: "awaiting confirmation",
  booked: "booked",
  confirmed: "confirmed",
  arrived: "waiting",
  in_chair: "in the chair",
  completed: "done",
  no_show: "no-show",
  emergency: "emergency",
};

/** The day view's lane for walk-ins with no chair (by chair) or no doctor (by doctor). */
const UNASSIGNED = "unassigned";
/** Grid event ids of walk-ins, so a click opens the patient rather than an appointment. */
const WALK_IN_PREFIX = "walk-in:";
/** How long an open walk-in is drawn: the booking form's default visit length. */
const OPEN_VISIT_MINUTES = 30;

/**
 * How a walk-in looks: closed in the completed green, open today like a patient in the chair, and open from an
 * earlier day neutral (it was never closed, so nobody is in the chair now). Open ones take the default visit length.
 */
export function walkInLook(w: Pick<CalendarWalkIn, "status" | "starts_at" | "ends_at">, today: string, timeZone: string): { tone: string; status?: EventStatus; word: string; endsAt: string } {
  const defaultEnd = new Date(Date.parse(w.starts_at) + OPEN_VISIT_MINUTES * 60_000).toISOString();
  if (w.status === "closed") {
    return { tone: CHIP.completed, status: "completed", word: "done", endsAt: w.ends_at ?? defaultEnd };
  }
  if (placementOf(w.starts_at, w.starts_at, timeZone).date === today) {
    return { tone: CHIP.in_chair, status: "in_chair", word: "in the chair", endsAt: defaultEnd };
  }
  return { tone: CHIP.cancelled, word: "not closed", endsAt: defaultEnd };
}

/** The days the view shows, which is exactly what is requested: a week, a day, or the month grid (at most 42 days). */
export function visibleRange(view: View, anchor: string): { from: string; to: string } {
  if (view === "week") {
    const from = mondayOf(anchor);
    return { from, to: addDays(from, 6) };
  }
  if (view === "month") {
    const days = monthWeeks(anchor).flat();
    return { from: days[0] ?? anchor, to: days.at(-1) ?? anchor };
  }
  return { from: anchor, to: anchor };
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
  // New look only: narrow the whole schedule to one doctor (`practitioner_id` on the request).
  const [newLook] = useNewLook();
  const [doctorId, setDoctorId] = useState<PractitionerId | undefined>(undefined);
  // `?patient=<id>` (Patient 360's Follow-up) prefills the booking form. The range sync below rewrites the URL, so keep it here.
  const [bookPatient, setBookPatient] = useState(() => searchParams.get("patient"));
  const [bookingOpen, setBookingOpen] = useState(searchParams.get("book") === "1");
  // The day of an empty slot chosen on the grid; the form opens on it (until then it follows the range).
  const [bookDate, setBookDate] = useState<string | undefined>(undefined);
  // The empty slot clicked on the grid: its start, and the doctor or chair column in the day view.
  const [bookAt, setBookAt] = useState<{ time: string; practitionerId?: string; roomId?: string } | undefined>(undefined);
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

  const { from, to } = visibleRange(view, anchor);
  // The range rides in the URL (ISO dates only, never patient data) so the view can be shared or reloaded.
  useEffect(() => {
    setSearchParams(
      (prev) => {
        if (prev.get("from") === from && prev.get("to") === to && !prev.has("book")) return prev;
        const next = new URLSearchParams(prev);
        // `book` has done its job once the form is open.
        next.delete("book");
        next.set("from", from);
        next.set("to", to);
        return next;
      },
      { replace: true },
    );
  }, [from, to, setSearchParams]);
  const filter = { from, to, ...(newLook && doctorId !== undefined ? { practitionerId: doctorId } : {}) };
  const appointments = useAppointments(filter);
  // Same range and filters; a failure here never blocks the appointments.
  const walkIns = useWalkIns(filter);
  const navigate = useNavigate();
  const rooms = useRooms();
  const practitioners = usePractitioners();
  // Approved time off for the days in view; a failure here never blocks the schedule.
  const timeOff = useTimeOff({ from, to });
  const away = timeOff.data?.items ?? [];
  const people = practitioners.data?.items ?? [];
  const awayFor = (date: string) => awayOn(away, people, date, timeZone).filter((band) => !newLook || doctorId === undefined || band.practitionerId === doctorId);
  const canWrite = can("appointments.write");
  // Load working hours for doctors when viewing day view grouped by doctor
  const doctorIds = lane === "doctor" && view === "day" ? (practitioners.data?.items ?? []).map((p) => p.id) : [];
  const workingHoursResults = useWorkingHoursMany(doctorIds);

  const items = appointments.data?.items ?? [];
  const selected = items.find((a) => a.id === selectedId);

  const columns: GridColumn[] =
    view === "week"
      ? Array.from({ length: 7 }, (_, index) => {
          const date = addDays(from, index);
          return { id: date, label: WEEKDAY_LABELS[index] ?? "", dateLabel: date.slice(8, 10), current: date === today, showNow: date === today, away: awayFor(date) };
        })
      : (lane === "chair"
          ? (rooms.data?.items ?? []).map((room) => ({ id: room.id, label: room.name, away: awayFor(anchor) }))
          : (practitioners.data?.items ?? [])
              .map((p, i) => {
                const spans = workingHoursResults[i]?.data ? shiftsOn(workingHoursResults[i].data.shifts, anchor) : undefined;
                return { id: p.id, label: p.display_name, away: awayFor(anchor).filter((band) => band.practitionerId === p.id), ...(spans !== undefined ? { working: spans } : {}) };
              })
              .filter((c) => !newLook || doctorId === undefined || c.id === doctorId)
        ).map((c) => ({ ...c, showNow: anchor === today }));

  const doctorToneOf = (id: string) => Math.max(0, people.findIndex((p) => p.id === id)) % DOCTOR_TONES;
  const placed = items
    .filter((a) => a.status !== "cancelled")
    .flatMap((a): { event: GridEvent; startMin: number; endMin: number }[] => {
      const place = placementOf(a.starts_at, a.ends_at, timeZone);
      const columnId = view === "week" ? place.date : lane === "chair" ? (a.room_id ?? "") : a.practitioner.id;
      if (view === "day" && columnId === "") {
        return [];
      }
      const time = formatTime(a.starts_at, timeZone);
      const doctorAway = isAway(away, people.find((p) => p.id === a.practitioner.id), a.starts_at, a.ends_at);
      // Day by chair: the chair is the column, so name the doctor; by doctor: name the chair. The week names both.
      const detail = a.status === "requested" ? "Requested online" : view === "week" ? `${a.practitioner.display_name}${a.room == null ? "" : ` · ${a.room}`}` : lane === "chair" ? a.practitioner.display_name : (a.room ?? a.practitioner.display_name);
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
            subtitle: `${time} · ${a.reason == null || a.reason === "" ? "" : `${a.reason} · `}${detail}${doctorAway ? " · Doctor away" : ""}`,
            tone: toneOf(a),
            status: eventStatusOf(a),
            doctorTone: doctorToneOf(a.practitioner.id),
            visitKind: a.patient_type,
            // Follow-ups are the usual case, so only a first visit is marked on the chip.
            ...(a.patient_type === "new" ? { tag: "New" } : {}),
            label: `${a.status === "requested" ? "Requested: " : ""}${a.patient.full_name}, ${a.reason ?? "Consultation"} at ${time}, ${detail}${doctorAway ? ", doctor away" : ""}, ${visitKindLabel(a.patient_type).toLowerCase()}, ${STATUS_WORD[eventStatusOf(a)]}`,
          },
        },
      ];
    });
  // Walk-ins: visits with no appointment, drawn beside the bookings with a dashed outline. They never block the schedule.
  const walkInItems = walkIns.data?.items ?? [];
  const walkInPlaced = walkInItems.flatMap((w): { event: GridEvent; startMin: number; endMin: number }[] => {
    const look = walkInLook(w, today, timeZone);
    const place = placementOf(w.starts_at, look.endsAt, timeZone);
    const columnId = view === "week" ? place.date : lane === "chair" ? (w.room_id ?? UNASSIGNED) : (w.practitioner?.id ?? UNASSIGNED);
    const time = formatTime(w.starts_at, timeZone);
    // Like the bookings: the week names the chair and the doctor; a day by chair names the doctor, by doctor the chair.
    const parts = [view === "week" || lane === "chair" ? w.practitioner?.display_name : undefined, view === "week" || lane === "doctor" ? w.room : undefined].filter((part): part is string => part != null && part !== "");
    const detail = parts.join(" · ");
    return [
      {
        startMin: place.startMin,
        endMin: place.endMin,
        event: {
          id: `${WALK_IN_PREFIX}${w.visit_id}`,
          columnId,
          startMin: place.startMin,
          endMin: place.endMin,
          title: w.patient.full_name,
          subtitle: `${time} · Walk-in${detail === "" ? "" : ` · ${detail}`}`,
          tone: look.tone,
          ...(look.status === undefined ? {} : { status: look.status }),
          ...(w.practitioner == null ? {} : { doctorTone: doctorToneOf(w.practitioner.id) }),
          tag: "Walk-in",
          walkIn: true,
          label: `${w.patient.full_name}, walk-in at ${time}${parts.map((part) => `, ${part}`).join("")}, ${look.word}. Opens the patient`,
        },
      },
    ];
  });
  const openWalkIn = (id: string): boolean => {
    if (!id.startsWith(WALK_IN_PREFIX)) return false;
    const found = walkInItems.find((w) => `${WALK_IN_PREFIX}${w.visit_id}` === id);
    if (found !== undefined) void navigate(`/patients/${found.patient.id}`);
    return true;
  };
  const select = (id: string) => {
    if (!openWalkIn(id)) setSelectedId(id);
  };
  const walkInsByDay: Record<string, number> = {};
  for (const w of walkInItems) {
    const date = placementOf(w.starts_at, w.starts_at, timeZone).date;
    walkInsByDay[date] = (walkInsByDay[date] ?? 0) + 1;
  }
  const monthItems: MonthItem[] = items
    .filter((a) => a.status !== "cancelled")
    .map((a) => {
      const place = placementOf(a.starts_at, a.ends_at, timeZone);
      return { id: a.id, date: place.date, startMin: place.startMin, tone: toneOf(a), doctorTone: doctorToneOf(a.practitioner.id), label: `${a.status === "requested" ? "? " : ""}${formatTime(a.starts_at, timeZone).replace(/ ?[ap]m$/i, "")} ${a.patient.full_name}` };
    });
  const monthAway: MonthAway[] = view === "month" ? monthWeeks(anchor).flat().flatMap((date) => awayFor(date).map((band) => ({ id: band.id, date, name: band.name }))) : [];
  const allPlaced = [...placed, ...walkInPlaced];
  const events = allPlaced.map((p) => p.event);
  // Day view: walk-ins with no chair (by chair) or no doctor (by doctor) go in an Unassigned lane at the end.
  const gridColumns: GridColumn[] = view === "day" && columns.length > 0 && events.some((e) => e.columnId === UNASSIGNED) ? [...columns, { id: UNASSIGNED, label: "Unassigned", showNow: anchor === today }] : columns;
  const bookSlot = ({ columnId, startMin }: BookSlot) => {
    setBookDate(view === "week" ? columnId : anchor);
    setBookAt({
      time: formatHm(startMin),
      ...(view === "day" && lane === "doctor" ? { practitionerId: columnId } : {}),
      ...(view === "day" && lane === "chair" ? { roomId: columnId } : {}),
    });
    setBookingOpen(true);
  };
  const hours = gridHours(allPlaced);
  const nowOnClinicClock = nowMinutes(clock, timeZone);

  const stepBy = view === "week" ? 7 : 1;
  const rangeLabel = view === "month" ? new Date(`${monthStartOf(anchor)}T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }) : view === "week" ? `${shortDate(from)} – ${shortDate(to, true)}` : shortDate(from, true);

  return (
    <div className={`mk-panel${newLook ? " cal2" : ""}`}>
      <PageHeader
        eyebrow={`Schedule · ${new Date(`${anchor}T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" })}`}
        title="Calendar"
        subtitle={`${session.clinic.name} · ${appointments.isPending ? "loading the schedule" : `${String(items.filter((a) => a.status !== "cancelled").length)} booked in view${walkInItems.length === 0 ? "" : ` · ${String(walkInItems.length)} ${walkInItems.length === 1 ? "walk-in" : "walk-ins"}`}`}`}
        actions={
          canWrite ? (
            <button
              type="button"
              className="mk-btn mk-btn-primary"
              onClick={() => {
                setBookingOpen(true);
              }}
            >
              <Plus aria-hidden="true" /> {newLook ? "New appointment" : "Book appointment"}
            </button>
          ) : undefined
        }
      />
      <div className="mk-ptools cal-bar">
        <div className="cal-nav">
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
        <b className="cal-range" aria-live="polite">
          {rangeLabel}
        </b>
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
        </div>
        <div className="cal-view">
        <span role="group" aria-label="View" className="mk-seg">
          {(["day", "week", "month"] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              onClick={() => {
                setView(v);
              }}
            >
              {v === "day" ? "Day" : v === "week" ? "Week" : "Month"}
            </button>
          ))}
        </span>
        {view === "day" ? <DatePicker value={anchor} onChange={setAnchor} today={today} id="cal-day" className="mk-dp-compact" /> : null}
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
            aria-label="Group columns by"
            className="max-w-40"
          />
        ) : null}
        </div>
      </div>
      {newLook ? (
        <div className="cal2-docs" role="group" aria-label="Filter by doctor">
          <button
            type="button"
            className="mk-chipf"
            aria-pressed={doctorId === undefined}
            onClick={() => {
              setDoctorId(undefined);
            }}
          >
            All doctors
          </button>
          {(practitioners.data?.items ?? []).map((p, index) => (
            <button
              key={p.id}
              type="button"
              className="mk-chipf"
              aria-pressed={doctorId === p.id}
              onClick={() => {
                setDoctorId(p.id);
              }}
            >
              <i className={`mk-docdot d${String(index % DOCTOR_TONES)}`} aria-hidden="true" />
              {p.display_name}
            </button>
          ))}
        </div>
      ) : null}
      <MkCard title={view === "week" ? "Week view" : view === "month" ? "Month view" : "Day view"} action={<Legend {...(newLook ? {} : { doctors: people.map((p) => ({ id: p.id, name: p.display_name })) })} />}>
        {appointments.isPending ? (
          <SkeletonRows count={8} tall label="Loading the schedule" />
        ) : appointments.isError ? (
          apiErrorOf(appointments.error)?.status === 404 ? (
            <EmptyState art="calendar" title="Appointments aren't connected yet" description="The schedule will appear here once the API serves appointments." />
          ) : (
            <ApiErrorNotice title="Couldn't load the schedule" error={appointments.error} onRetry={() => void appointments.refetch()} />
          )
        ) : view === "month" ? (
          <div className="mk-tablewrap">
            <MonthView
              month={anchor}
              today={today}
              items={monthItems}
              walkIns={walkInsByDay}
              away={monthAway}
              onSelect={setSelectedId}
              onOpenDay={(date) => {
                setAnchor(date);
                setView("day");
              }}
            />
          </div>
        ) : columns.length === 0 ? (
          <EmptyState
            art={lane === "chair" ? "queue" : "team"}
            title={lane === "chair" ? COPY.noChairs : COPY.noDoctors}
            description={COPY.addInSettings}
            action={
              <Link to="/settings" className="mk-btn mk-btn-ghost">
                Open Settings
              </Link>
            }
          />
        ) : (
          <TimeGrid
            columns={gridColumns}
            events={events}
            startHour={hours.start}
            endHour={hours.end}
            nowMinute={nowOnClinicClock.minutes}
            workingMinutes={WORKING_MINUTES}
            summary={`Appointments from ${from} to ${to}`}
            onSelect={select}
            {...(canWrite ? { onBook: bookSlot } : {})}
          />
        )}
        {appointments.isSuccess && view !== "month" && columns.length > 0 && events.length === 0 ? (
          <p role="status" className="cal-calm">
            {view === "week" ? COPY.calmWeek : COPY.calmDay}
          </p>
        ) : null}
        {appointments.isSuccess && walkIns.isError && apiErrorOf(walkIns.error)?.status !== 404 ? (
          <p role="status" className="cal-calm">
            Walk-ins couldn&apos;t be loaded. Appointments are shown.
          </p>
        ) : null}
      </MkCard>

      <BookingDialog
        open={bookingOpen}
        onOpenChange={(open) => {
          setBookingOpen(open);
          if (!open) {
            setBookPatient(null);
            setBookDate(undefined);
            setBookAt(undefined);
          }
        }}
        timeZone={timeZone}
        rooms={rooms.data?.items ?? []}
        practitioners={practitioners.data?.items ?? []}
        defaultDate={bookDate ?? anchor}
        defaultTime={bookAt?.time}
        defaultPractitionerId={bookAt?.practitionerId}
        defaultRoomId={bookAt?.roomId}
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
