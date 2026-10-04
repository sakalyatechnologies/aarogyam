import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";

import { apiErrorOf, type AppointmentStatus } from "@aarogyam/api-client";
import { ApiErrorNotice, useDocumentTitle } from "@aarogyam/app-kit";
import { Button, Card, ChipFilterGroup, EmptyState, PageHeader, Select, Skeleton, WeekGrid, type Tone, type WeekGridBlock, type WeekGridDay } from "@sakalya/ui";

import { useClinic } from "../../clinic.js";
import { addDays, localDateHour, mondayOf, todayIn } from "../../lib/time.js";
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
  const [bookingOpen, setBookingOpen] = useState(false);
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
  const rangeLabel = view === "week" ? `${from} – ${to}` : from;

  return (
    <>
      <PageHeader
        title="Calendar"
        end={
          canWrite ? (
            <Button
              icon={<Plus aria-hidden="true" className="size-4" />}
              onClick={() => {
                setBookingOpen(true);
              }}
            >
              New appointment
            </Button>
          ) : undefined
        }
      />
      <Card>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              aria-label="Previous"
              icon={<ChevronLeft aria-hidden="true" className="size-4" />}
              onClick={() => {
                setAnchor((prev) => addDays(prev, -stepBy));
              }}
            />
            <Button
              variant="secondary"
              onClick={() => {
                setAnchor(today);
              }}
            >
              Today
            </Button>
            <Button
              variant="ghost"
              aria-label="Next"
              icon={<ChevronRight aria-hidden="true" className="size-4" />}
              onClick={() => {
                setAnchor((prev) => addDays(prev, stepBy));
              }}
            />
            <p className="text-sm font-semibold text-text">{rangeLabel}</p>
          </div>
          <div className="flex items-center gap-2">
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
            <ChipFilterGroup
              label="View"
              value={[view]}
              onValueChange={(next) => {
                const picked = next[0];
                if (picked === "day" || picked === "week") setView(picked);
              }}
              options={[
                { value: "day", label: "Day" },
                { value: "week", label: "Week" },
              ]}
            />
          </div>
        </div>

        {appointments.isPending ? (
          <Skeleton shape="block" />
        ) : appointments.isError ? (
          apiErrorOf(appointments.error)?.status === 404 ? (
            <EmptyState title="Appointments aren't connected yet" description="The schedule will appear here once the API serves appointments." />
          ) : (
            <ApiErrorNotice title="Couldn't load the schedule" error={appointments.error} onRetry={() => void appointments.refetch()} />
          )
        ) : days.length === 0 ? (
          <EmptyState
            title={view === "day" && lane === "chair" ? "No chairs set up yet" : "No doctors set up yet"}
            description="Add them in Settings to see the schedule here."
          />
        ) : (
          <WeekGrid
            days={days}
            startHour={8}
            endHour={20}
            blocks={blocks}
            summary={`Appointments from ${from} to ${to}`}
            onBlockSelect={setSelectedId}
          />
        )}
      </Card>

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
    </>
  );
}
