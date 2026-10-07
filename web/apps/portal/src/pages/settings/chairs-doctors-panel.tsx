import { Clock3, MoreVertical, Plane, Plus } from "lucide-react";
import { useState } from "react";

import { apiErrorOf, type Leave, type Practitioner, type PractitionerId, type Room, type WorkingHours } from "@aarogyam/api-client";
import { ApiErrorNotice, formatDateTime } from "@aarogyam/app-kit";
import { Button, Card, DataTable, DateInput, Dialog, Field, Menu, Pill, Select, Skeleton, Switch, TextArea, TextInput, useToast, type DataTableColumn, type MenuItem } from "@sakalya/ui";

import { useClinic } from "../../clinic.js";
import { useTodayDate } from "../../lib/patients.js";
import { addDays, localInstant } from "../../lib/time.js";
import {
  useAddLeave,
  useAddPractitioner,
  useAddRoom,
  useChangePractitioner,
  useChangeRoom,
  useLeave,
  useRemoveLeave,
  useRemovePractitioner,
  useRemoveRoom,
  useRooms,
  useSetWorkingHours,
  useWorkingHours,
  usePractitioners,
} from "../../queries.js";
import { EmptyState } from "../../components/mk/index.js";

const ROOM_KINDS = [
  { value: "chair", label: "Chair" },
  { value: "room", label: "Room" },
  { value: "lab", label: "Lab" },
] as const;

const WEEKDAYS = [
  { weekday: 1, label: "Monday" },
  { weekday: 2, label: "Tuesday" },
  { weekday: 3, label: "Wednesday" },
  { weekday: 4, label: "Thursday" },
  { weekday: 5, label: "Friday" },
  { weekday: 6, label: "Saturday" },
  { weekday: 7, label: "Sunday" },
] as const;

/** Settings -> Chairs and doctors: rooms, practitioners, their weekly hours and leave. Needs `settings.manage`. */
export function ChairsDoctorsPanel() {
  return (
    <div className="flex flex-col gap-6">
      <RoomsSection />
      <PractitionersSection />
      <LeaveSection />
    </div>
  );
}

function RoomsSection() {
  const rooms = useRooms();
  const [dialog, setDialog] = useState<{ room?: Room } | undefined>(undefined);
  const remove = useRemoveRoom();
  const toast = useToast();

  if (rooms.isPending) {
    return <Skeleton shape="block" />;
  }
  if (rooms.isError) {
    return <ApiErrorNotice title="Couldn't load chairs and rooms" error={rooms.error} onRetry={() => void rooms.refetch()} />;
  }

  const columns: readonly DataTableColumn<Room>[] = [
    { id: "name", header: "Name", cell: (r) => r.name },
    { id: "kind", header: "Kind", cell: (r) => ROOM_KINDS.find((k) => k.value === r.kind)?.label ?? r.kind },
    { id: "active", header: "Status", cell: (r) => <Pill tone={r.active ? "success" : "neutral"}>{r.active ? "Active" : "Retired"}</Pill> },
    {
      id: "actions",
      header: "Actions",
      hideHeader: true,
      cell: (r) => {
        const items: MenuItem[] = [
          { id: "edit", label: "Edit" },
          { id: "remove", label: "Remove", danger: true, separatorBefore: true },
        ];
        return (
          <Menu
            label={`Actions for ${r.name}`}
            icon={<MoreVertical aria-hidden="true" className="size-4" />}
            items={items}
            onSelect={(id) => {
              if (id === "edit") {
                setDialog({ room: r });
              } else {
                remove.mutate(r.id, {
                  onError: (thrown) => {
                    toast.show({ title: apiErrorOf(thrown)?.message ?? "Couldn't remove that chair.", tone: "danger" });
                  },
                });
              }
            }}
          />
        );
      },
    },
  ];

  return (
    <Card
      title="Chairs and rooms"
      action={
        <Button
          variant="secondary"
          icon={<Plus aria-hidden="true" className="size-4" />}
          onClick={() => {
            setDialog({});
          }}
        >
          Add chair
        </Button>
      }
    >
      <DataTable
        caption="Chairs and rooms"
        columns={columns}
        rows={rooms.data.items}
        rowKey={(r) => r.id}
        empty={{ title: "No chairs yet", description: "Add a chair to start booking appointments into it." }}
      />
      {dialog === undefined ? null : <RoomDialog room={dialog.room} onOpenChange={() => { setDialog(undefined); }} />}
    </Card>
  );
}

function RoomDialog({ room, onOpenChange }: { room: Room | undefined; onOpenChange: () => void }) {
  const [name, setName] = useState(room?.name ?? "");
  const [kind, setKind] = useState<(typeof ROOM_KINDS)[number]["value"]>(room?.kind === "room" || room?.kind === "lab" ? room.kind : "chair");
  const [active, setActive] = useState(room?.active ?? true);
  const [error, setError] = useState<string | undefined>(undefined);
  const add = useAddRoom();
  const change = useChangeRoom();
  const pending = add.isPending || change.isPending;

  const submit = () => {
    setError(undefined);
    const onError = (thrown: unknown) => {
      setError(apiErrorOf(thrown)?.message ?? "Couldn't save that chair. Please try again.");
    };
    if (room === undefined) {
      add.mutate({ name, kind, active }, { onSuccess: onOpenChange, onError });
    } else {
      change.mutate({ id: room.id, changes: { name, kind, active } }, { onSuccess: onOpenChange, onError });
    }
  };

  return (
    <Dialog
      open
      onOpenChange={onOpenChange}
      title={room === undefined ? "Add a chair" : "Edit chair"}
      footer={
        <>
          <Button variant="secondary" onClick={onOpenChange}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={name.trim() === "" || pending}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Name" required>
          <TextInput
            value={name}
            onChange={(event) => {
              setName(event.target.value);
            }}
          />
        </Field>
        <Field label="Kind">
          <Select options={ROOM_KINDS} value={kind} onValueChange={setKind} />
        </Field>
        <Switch label="Can be booked" checked={active} onCheckedChange={setActive} />
        {error === undefined ? null : (
          <p role="alert" className="text-sm font-medium text-danger-text">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}

type PractitionerDialogState = { practitioner?: Practitioner } | { hoursFor: Practitioner };

function PractitionersSection() {
  const practitioners = usePractitioners();
  const [dialog, setDialog] = useState<PractitionerDialogState | undefined>(undefined);
  const remove = useRemovePractitioner();
  const toast = useToast();

  if (practitioners.isPending) {
    return <Skeleton shape="block" />;
  }
  if (practitioners.isError) {
    return <ApiErrorNotice title="Couldn't load doctors" error={practitioners.error} onRetry={() => void practitioners.refetch()} />;
  }

  const columns: readonly DataTableColumn<Practitioner>[] = [
    { id: "name", header: "Name", cell: (p) => p.display_name },
    { id: "specialty", header: "Specialty", cell: (p) => p.specialty ?? "—" },
    { id: "active", header: "Status", cell: (p) => <Pill tone={p.active ? "success" : "neutral"}>{p.active ? "Active" : "Retired"}</Pill> },
    {
      id: "actions",
      header: "Actions",
      hideHeader: true,
      cell: (p) => {
        const items: MenuItem[] = [
          { id: "edit", label: "Edit" },
          { id: "hours", label: "Working hours" },
          { id: "remove", label: "Remove", danger: true, separatorBefore: true },
        ];
        return (
          <Menu
            label={`Actions for ${p.display_name}`}
            icon={<MoreVertical aria-hidden="true" className="size-4" />}
            items={items}
            onSelect={(id) => {
              if (id === "edit") {
                setDialog({ practitioner: p });
              } else if (id === "hours") {
                setDialog({ hoursFor: p });
              } else {
                remove.mutate(p.id, {
                  onError: (thrown) => {
                    toast.show({ title: apiErrorOf(thrown)?.message ?? "Couldn't remove that doctor.", tone: "danger" });
                  },
                });
              }
            }}
          />
        );
      },
    },
  ];

  return (
    <Card
      title="Doctors"
      action={
        <Button
          variant="secondary"
          icon={<Plus aria-hidden="true" className="size-4" />}
          onClick={() => {
            setDialog({});
          }}
        >
          Add doctor
        </Button>
      }
    >
      <DataTable
        caption="Doctors"
        columns={columns}
        rows={practitioners.data.items}
        rowKey={(p) => p.id}
        empty={{ title: "No doctors yet", description: "Add a doctor to start booking appointments with them." }}
      />
      {dialog === undefined ? null : "hoursFor" in dialog ? (
        <WorkingHoursDialog practitioner={dialog.hoursFor} onOpenChange={() => { setDialog(undefined); }} />
      ) : (
        <PractitionerDialog practitioner={dialog.practitioner} onOpenChange={() => { setDialog(undefined); }} />
      )}
    </Card>
  );
}

function PractitionerDialog({ practitioner, onOpenChange }: { practitioner: Practitioner | undefined; onOpenChange: () => void }) {
  const [displayName, setDisplayName] = useState(practitioner?.display_name ?? "");
  const [specialty, setSpecialty] = useState(practitioner?.specialty ?? "");
  const [qualifications, setQualifications] = useState(practitioner?.qualifications ?? "");
  const [registration, setRegistration] = useState(practitioner?.registration_number ?? "");
  const [calendarColor, setCalendarColor] = useState(practitioner?.calendar_color ?? "#64748b");
  const [active, setActive] = useState(practitioner?.active ?? true);
  const [error, setError] = useState<string | undefined>(undefined);
  const add = useAddPractitioner();
  const change = useChangePractitioner();
  const pending = add.isPending || change.isPending;

  const submit = () => {
    setError(undefined);
    const onError = (thrown: unknown) => {
      setError(apiErrorOf(thrown)?.message ?? "Couldn't save that doctor. Please try again.");
    };
    const fields = {
      display_name: displayName,
      specialty,
      qualifications,
      registration_number: registration,
      calendar_color: calendarColor,
      active,
    };
    if (practitioner === undefined) {
      add.mutate(fields, { onSuccess: onOpenChange, onError });
    } else {
      change.mutate({ id: practitioner.id, changes: fields }, { onSuccess: onOpenChange, onError });
    }
  };

  return (
    <Dialog
      open
      onOpenChange={onOpenChange}
      title={practitioner === undefined ? "Add a doctor" : "Edit doctor"}
      footer={
        <>
          <Button variant="secondary" onClick={onOpenChange}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={displayName.trim() === "" || pending}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Name" required>
          <TextInput
            value={displayName}
            onChange={(event) => {
              setDisplayName(event.target.value);
            }}
          />
        </Field>
        <Field label="Specialty">
          <TextInput
            value={specialty}
            onChange={(event) => {
              setSpecialty(event.target.value);
            }}
          />
        </Field>
        <Field label="Qualifications" hint="Printed under the name on the letterhead, such as BDS, MDS">
          <TextInput
            value={qualifications}
            maxLength={160}
            onChange={(event) => {
              setQualifications(event.target.value);
            }}
          />
        </Field>
        <Field label="Registration number" hint="Dental or medical council number, printed on prescriptions">
          <TextInput
            value={registration}
            maxLength={40}
            onChange={(event) => {
              setRegistration(event.target.value);
            }}
          />
        </Field>
        <Field label="Calendar colour" hint="#RRGGBB">
          <TextInput
            value={calendarColor}
            onChange={(event) => {
              setCalendarColor(event.target.value);
            }}
          />
        </Field>
        <Switch label="Can be booked" checked={active} onCheckedChange={setActive} />
        {error === undefined ? null : (
          <p role="alert" className="text-sm font-medium text-danger-text">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}

interface DayHours {
  enabled: boolean;
  starts: string;
  ends: string;
}

function hoursToDays(hours: WorkingHours | undefined): Record<number, DayHours> {
  const days: Record<number, DayHours> = {};
  for (const { weekday } of WEEKDAYS) {
    const shift = hours?.shifts.find((s) => s.weekday === weekday);
    days[weekday] = shift === undefined ? { enabled: false, starts: "09:00", ends: "18:00" } : { enabled: true, starts: shift.starts, ends: shift.ends };
  }
  return days;
}

function WorkingHoursDialog({ practitioner, onOpenChange }: { practitioner: Practitioner; onOpenChange: () => void }) {
  const hours = useWorkingHours(practitioner.id);
  const setHours = useSetWorkingHours();
  const toast = useToast();
  const [days, setDays] = useState<Record<number, DayHours> | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);

  if (days === undefined && hours.data !== undefined) {
    setDays(hoursToDays(hours.data));
  }

  const submit = () => {
    if (days === undefined) {
      return;
    }
    setError(undefined);
    const shifts = WEEKDAYS.filter(({ weekday }) => days[weekday]?.enabled).map(({ weekday }) => {
      const day = days[weekday];
      return { weekday, starts: day?.starts ?? "09:00", ends: day?.ends ?? "18:00" };
    });
    setHours.mutate(
      { id: practitioner.id, hours: { shifts } },
      {
        onSuccess: () => {
          toast.show({ title: `Saved ${practitioner.display_name}'s hours`, tone: "success" });
          onOpenChange();
        },
        onError: (thrown) => {
          setError(apiErrorOf(thrown)?.message ?? "Couldn't save those hours. Please try again.");
        },
      },
    );
  };

  return (
    <Dialog
      open
      onOpenChange={onOpenChange}
      title={`${practitioner.display_name}'s working hours`}
      description="One shift a day. Turn a day off to clear it."
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onOpenChange}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={days === undefined || setHours.isPending}>
            {setHours.isPending ? "Saving…" : "Save hours"}
          </Button>
        </>
      }
    >
      {hours.isPending || days === undefined ? (
        <Skeleton shape="block" />
      ) : hours.isError ? (
        <ApiErrorNotice title="Couldn't load working hours" error={hours.error} onRetry={() => void hours.refetch()} />
      ) : (
        <div className="flex flex-col gap-3">
          {WEEKDAYS.map(({ weekday, label }) => {
            const day = days[weekday] ?? { enabled: false, starts: "09:00", ends: "18:00" };
            return (
              <div key={weekday} className="flex flex-wrap items-center gap-3 rounded-xl border border-border p-3">
                <Switch
                  label={label}
                  checked={day.enabled}
                  onCheckedChange={(enabled) => {
                    setDays((prev) => ({ ...(prev ?? {}), [weekday]: { ...day, enabled } }));
                  }}
                />
                {day.enabled ? (
                  <div className="flex items-center gap-2">
                    <TextInput
                      aria-label={`${label} start time`}
                      className="w-24"
                      value={day.starts}
                      onChange={(event) => {
                        setDays((prev) => ({ ...(prev ?? {}), [weekday]: { ...day, starts: event.target.value } }));
                      }}
                    />
                    <span className="text-sm text-muted">to</span>
                    <TextInput
                      aria-label={`${label} end time`}
                      className="w-24"
                      value={day.ends}
                      onChange={(event) => {
                        setDays((prev) => ({ ...(prev ?? {}), [weekday]: { ...day, ends: event.target.value } }));
                      }}
                    />
                  </div>
                ) : (
                  <span className="text-sm text-muted">Not working</span>
                )}
              </div>
            );
          })}
        </div>
      )}
      {error === undefined ? null : (
        <p role="alert" className="mt-3 text-sm font-medium text-danger-text">
          {error}
        </p>
      )}
    </Dialog>
  );
}

function LeaveSection() {
  const { session } = useClinic();
  const today = useTodayDate();
  const farOut = addDays(today, 90);
  const leave = useLeave({ from: today, to: farOut });
  const practitioners = usePractitioners();
  const remove = useRemoveLeave();
  const toast = useToast();
  const [adding, setAdding] = useState(false);

  if (leave.isPending) {
    return <Skeleton shape="block" />;
  }
  if (leave.isError) {
    return <ApiErrorNotice title="Couldn't load leave" error={leave.error} onRetry={() => void leave.refetch()} />;
  }

  return (
    <Card
      title="Upcoming leave"
      action={
        <Button
          variant="secondary"
          icon={<Plane aria-hidden="true" className="size-4" />}
          onClick={() => {
            setAdding(true);
          }}
        >
          Add leave
        </Button>
      }
    >
      {leave.data.items.length === 0 ? (
        <EmptyState title="No leave booked" description="A doctor's time off will show here." icon={<Clock3 className="size-7" />} />
      ) : (
        <ul className="divide-y divide-border">
          {leave.data.items.map((item: Leave) => {
            const practitioner = practitioners.data?.items.find((p) => p.id === item.practitioner_id);
            return (
              <li key={item.id} className="flex items-center justify-between gap-3 py-3">
                <div>
                  <p className="text-sm font-bold text-text">{practitioner?.display_name ?? "A doctor"}</p>
                  <p className="text-xs text-muted">
                    {formatDateTime(item.starts_at)} – {formatDateTime(item.ends_at)}
                    {item.reason == null ? "" : ` · ${item.reason}`}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  onClick={() => {
                    remove.mutate(item.id, {
                      onError: (thrown) => {
                        toast.show({ title: apiErrorOf(thrown)?.message ?? "Couldn't remove that leave.", tone: "danger" });
                      },
                    });
                  }}
                >
                  Remove
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      {adding ? (
        <AddLeaveDialog
          practitioners={practitioners.data?.items ?? []}
          timeZone={session.clinic.timezone}
          onOpenChange={() => {
            setAdding(false);
          }}
        />
      ) : null}
    </Card>
  );
}

function AddLeaveDialog({
  practitioners,
  timeZone,
  onOpenChange,
}: {
  practitioners: readonly { id: PractitionerId; display_name: string }[];
  timeZone: string;
  onOpenChange: () => void;
}) {
  const today = useTodayDate();
  const [practitionerId, setPractitionerId] = useState("");
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);
  const add = useAddLeave();

  const submit = () => {
    setError(undefined);
    add.mutate(
      {
        practitioner_id: practitionerId,
        starts_at: localInstant(startDate, "00:00", timeZone),
        ends_at: localInstant(endDate, "23:59", timeZone),
        ...(reason.trim() === "" ? {} : { reason: reason.trim() }),
      },
      {
        onSuccess: onOpenChange,
        onError: (thrown) => {
          setError(apiErrorOf(thrown)?.message ?? "Couldn't record that leave. Please try again.");
        },
      },
    );
  };

  return (
    <Dialog
      open
      onOpenChange={onOpenChange}
      title="Add leave"
      footer={
        <>
          <Button variant="secondary" onClick={onOpenChange}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={practitionerId === "" || add.isPending}>
            {add.isPending ? "Saving…" : "Save"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Doctor" required>
          <Select options={practitioners.map((p) => ({ value: p.id, label: p.display_name }))} value={practitionerId} onValueChange={setPractitionerId} placeholder="Choose a doctor" />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="From">
            <DateInput value={startDate} onValueChange={setStartDate} />
          </Field>
          <Field label="To">
            <DateInput value={endDate} onValueChange={setEndDate} />
          </Field>
        </div>
        <Field label="Reason">
          <TextArea
            value={reason}
            onChange={(event) => {
              setReason(event.target.value);
            }}
          />
        </Field>
        {error === undefined ? null : (
          <p role="alert" className="text-sm font-medium text-danger-text">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}
