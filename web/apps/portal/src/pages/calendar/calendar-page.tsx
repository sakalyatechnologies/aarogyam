import { Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";

import { apiErrorOf, type AppointmentStatus } from "@aarogyam/api-client";
import { ApiErrorNotice, useDocumentTitle } from "@aarogyam/app-kit";
import { EmptyState, Select, Skeleton, WeekGrid, type Tone, type WeekGridBlock, type WeekGridDay } from "@sakalya/ui";

import { MkCard } from "../../components/mk/index.js";
import { useClinic } from "../../clinic.js";
import { addDays, localDateHour, mondayOf, todayIn } from "../../lib/time.js";
import { formatTime } from "@aarogyam/app-kit";
import { useAppointments, usePractitioners, useRooms } from "../../queries.js";
import { AppointmentDialog } from "./appointment-dialog.js";
import { BookingDialog } from "./booking-dialog.js";

type View = "day" | "week";
type Lane = "chair" | "doctor";

const STATUS_TONE: Readonly<Record<AppointmentStatus, Tone>> = {
  booked: "neutral",
  confirmed: "info",
  arrived: "warning",
  in_chair: "primary",
  completed: "success",
  cancelled: "neutral",
  no_show: "danger",
};

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Mock-up chip colours by status: completed green, waiting amber, booked brand, new consult indigo. */
const CHIP: Readonly<Record<AppointmentStatus, string>> = {
  booked: "b",
  confirmed: "i",
  arrived: "a",
  in_chair: "b",
  completed: "g",
  cancelled: "n",
  no_show: "r",
};

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
  const [view, setView] = useState<View>("week");
  const [lane, setLane] = useState<Lane>("chair");
  const [bookingOpen, setBookingOpen] = useState(searchParams.get("book") === "1");
  // The top bar's New appointment button arrives here as `?book=1`; open the form once per arrival.
  const bookParam = searchParams.get("book") === "1";
  const [bookSeen, setBookSeen] = useState(bookParam);
  if (bookParam !== bookSeen) {
    setBookSeen(bookParam);
    if (bookParam) setBookingOpen(true);
  }
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);

  const from = view === "week" ? mondayOf(anchor) : anchor;
  const to = view === "week" ? addDays(from, 6) : anchor;
  // The range rides in the URL (ISO dates only, never patient data) so the view can be shared or reloaded.
  useEffect(() => {
    setSearchParams({ from, to }, { replace: true });
  }, [from, to, setSearchParams]);
  const appointments = useAppointments({ from, to });
  const rooms = useRooms();
  const practitioners = usePractitioners();
  const canWrite = can("appointments.write");

  const items = appointments.data?.items ?? [];
  const weekItems = items.filter((a) => a.status !== "cancelled");
  const selected = items.find((a) => a.id === selectedId);

  const days: WeekGridDay[] =
    view === "week"
      ? Array.from({ length: 7 }, (_, index) => {
          const date = addDays(from, index);
          return { id: date, label: WEEKDAY_LABELS[index] ?? "", dateLabel: date.slice(8, 10), current: date === today };
        })
      : lane === "chair"
        ? (rooms.data?.items ?? []).map((room) => ({ id: room.id, label: room.name, dateLabel: "" }))
        : (practitioners.data?.items ?? []).map((p) => ({ id: p.id, label: p.display_name, dateLabel: "" }));

  const blocks: WeekGridBlock[] = items
    .filter((a) => a.status !== "cancelled")
    .flatMap((a): WeekGridBlock[] => {
      const start = localDateHour(a.starts_at, timeZone);
      const durationHours = (Date.parse(a.ends_at) - Date.parse(a.starts_at)) / 3_600_000;
      const dayId = view === "week" ? start.date : lane === "chair" ? (a.room_id ?? "") : a.practitioner.id;
      if (view === "day" && dayId === "") {
        return [];
      }
      return [
        {
          id: a.id,
          dayId,
          start: start.hour,
          duration: durationHours,
          label: a.patient.full_name,
          subtitle: view === "week" ? `${a.practitioner.display_name}${a.room == null ? "" : ` · ${a.room}`}` : a.room ?? a.practitioner.display_name,
          tone: STATUS_TONE[a.status],
        },
      ];
    });

  const stepBy = view === "week" ? 7 : 1;
  const rangeLabel = view === "week" ? `${shortDate(from)} – ${shortDate(to, true)}` : shortDate(from, true);
  const slots = [8, 10, 12, 14, 16, 18] as const;
  const slotLabel = (hour: number) => `${String(hour > 12 ? hour - 12 : hour)}${hour >= 12 ? "p" : "a"}`;

  return (
    <div className="mk-panel">
      <h1 className="mk-sr">Calendar</h1>
      <div className="mk-ptools">
        <button
          type="button"
          className="mk-btn mk-btn-ghost"
          aria-label="Previous"
          onClick={() => {
            setAnchor((prev) => addDays(prev, -stepBy));
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
            setAnchor((prev) => addDays(prev, stepBy));
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
          {(["day", "week"] as const).map((v) => (
            <button
              key={v}
              type="button"
              className="mk-chipf"
              aria-pressed={view === v}
              onClick={() => {
                setView(v);
              }}
            >
              {v === "day" ? "Day" : "Week"}
            </button>
          ))}
          <button type="button" className="mk-chipf" disabled title="Month view is not available yet" style={{ opacity: 0.55, cursor: "not-allowed" }}>
            Month
          </button>
        </span>
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
      <MkCard title={view === "week" ? "Week view" : "Day view"} hint="Colour: completed · waiting · booked · new consult">
        {appointments.isPending ? (
          <Skeleton shape="block" />
        ) : appointments.isError ? (
          apiErrorOf(appointments.error)?.status === 404 ? (
            <EmptyState title="Appointments aren't connected yet" description="The schedule will appear here once the API serves appointments." />
          ) : (
            <ApiErrorNotice title="Couldn't load the schedule" error={appointments.error} onRetry={() => void appointments.refetch()} />
          )
        ) : view === "week" ? (
          <div className="mk-tablewrap">
            <div className="mk-cal" role="group" aria-label={`Appointments from ${from} to ${to}`}>
              <div />
              {days.map((d) => (
                <div key={d.id} className={`mk-dh ${d.current === true ? "today" : ""}`}>
                  {d.label}
                  <b>{d.dateLabel}</b>
                </div>
              ))}
              {slots.flatMap((slot) => [
                <div key={`s${String(slot)}`} className="mk-slot">
                  {slotLabel(slot)}
                </div>,
                ...days.map((d) => (
                  <div key={`${String(slot)}-${d.id}`} className="mk-day">
                    {weekItems
                      .filter((a) => {
                        const start = localDateHour(a.starts_at, timeZone);
                        return start.date === d.id && Math.max(8, Math.min(18, Math.floor(start.hour / 2) * 2)) === slot;
                      })
                      .map((a) => (
                        <button
                          key={a.id}
                          type="button"
                          className={`mk-evchip ${CHIP[a.kind === "emergency" ? "no_show" : a.kind === "new" && a.status !== "completed" && a.status !== "arrived" ? "confirmed" : a.status]}`}
                          aria-label={`${a.patient.full_name}, ${a.reason ?? "Consultation"} at ${formatTime(a.starts_at, timeZone)}`}
                          onClick={() => {
                            setSelectedId(a.id);
                          }}
                        >
                          {formatTime(a.starts_at, timeZone).replace(/ ?[ap]m$/i, "")} {a.reason ?? a.patient.full_name}
                        </button>
                      ))}
                  </div>
                )),
              ])}
            </div>
          </div>
        ) : days.length === 0 ? (
          <EmptyState
            title={lane === "chair" ? "No chairs set up yet" : "No doctors set up yet"}
            description="Add them in Settings to see the schedule here."
          />
        ) : (
          <WeekGrid days={days} startHour={8} endHour={20} blocks={blocks} summary={`Appointments from ${from} to ${to}`} onBlockSelect={setSelectedId} />
        )}
      </MkCard>

      <BookingDialog
        open={bookingOpen}
        onOpenChange={setBookingOpen}
        timeZone={timeZone}
        rooms={rooms.data?.items ?? []}
        practitioners={practitioners.data?.items ?? []}
        defaultDate={anchor}
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
