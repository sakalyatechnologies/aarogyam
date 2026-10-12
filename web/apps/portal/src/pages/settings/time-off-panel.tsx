import { Plane } from "lucide-react";
import { useState } from "react";

import { apiErrorOf, type AffectedAppointment, type NewTimeOff, type TimeOff, type TimeOffKind } from "@aarogyam/api-client";
import { ApiErrorNotice, formatTime } from "@aarogyam/app-kit";
import { Button, DateInput, Dialog, Field, Pill, Select, Skeleton, Switch, TextArea, TextInput, useToast } from "@sakalya/ui";

import { EmptyState, MkCard } from "../../components/mk/index.js";
import { useClinic } from "../../clinic.js";
import { useTodayDate } from "../../lib/patients.js";
import { parseHm } from "../../lib/slots.js";
import { addDays, localInstant } from "../../lib/time.js";
import { useAffectedLookup, useCancelTimeOff, useDecideTimeOff, useRequestTimeOff, useStaffOps, useTimeOff, useUpdateStaffOps } from "../../lib/time-off-queries.js";
import { useStaff } from "../../queries.js";
import { ReassignDialog } from "../calendar/reassign-dialog.js";

const KINDS: readonly { value: TimeOffKind; label: string }[] = [
  { value: "vacation", label: "Vacation" },
  { value: "sick", label: "Sick leave" },
  { value: "personal", label: "Personal" },
  { value: "other", label: "Other" },
];

const kindLabel = (kind: string | null | undefined): string => KINDS.find((k) => k.value === kind)?.label ?? "";

/** `5 Oct` in the clinic's zone. */
function dayText(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone }).format(new Date(iso));
}

/** `5 Oct – 7 Oct` for whole days, `5 Oct, 2:00 pm – 6:00 pm` for a stretch of one day, both ends otherwise. */
function windowText(t: Pick<TimeOff, "starts_at" | "ends_at" | "all_day">, timeZone: string): string {
  if (t.all_day) {
    // A whole-day request ends at the next local midnight; the last day it covers is a minute before.
    const first = dayText(t.starts_at, timeZone);
    const last = dayText(new Date(Date.parse(t.ends_at) - 60_000).toISOString(), timeZone);
    return first === last ? `${first}, all day` : `${first} – ${last}`;
  }
  const first = dayText(t.starts_at, timeZone);
  const last = dayText(t.ends_at, timeZone);
  return first === last ? `${first}, ${formatTime(t.starts_at, timeZone)} – ${formatTime(t.ends_at, timeZone)}` : `${first}, ${formatTime(t.starts_at, timeZone)} – ${last}, ${formatTime(t.ends_at, timeZone)}`;
}

const TONE = { pending: "warning", approved: "success", declined: "neutral", cancelled: "neutral" } as const;
const STATUS = { pending: "Waiting for approval", approved: "Approved", declined: "Declined", cancelled: "Cancelled" } as const;

/**
 * Settings -> Time off. Everyone requests their own time off; the owner (`time_off.manage`) also approves requests, adds
 * time off for anyone, and decides whether staff requests need approval. The reason is private: only the person and the
 * owner see it, and the calendar shows just "Away".
 */
export function TimeOffPanel() {
  const { session, can } = useClinic();
  const timeZone = session.clinic.timezone;
  const manage = can("time_off.manage");
  const today = useTodayDate();
  const list = useTimeOff({ from: addDays(today, -14), to: addDays(today, 120) });
  const decide = useDecideTimeOff();
  const cancel = useCancelTimeOff();
  const lookup = useAffectedLookup();
  const toast = useToast();
  const [requesting, setRequesting] = useState(false);
  const [declining, setDeclining] = useState<TimeOff | undefined>(undefined);
  const [reassign, setReassign] = useState<{ timeOff: TimeOff; items: readonly AffectedAppointment[] } | undefined>(undefined);

  if (list.isPending) {
    return <Skeleton shape="block" />;
  }
  if (list.isError) {
    return <ApiErrorNotice title="Couldn't load time off" error={list.error} onRetry={() => void list.refetch()} />;
  }

  const items = list.data.items;
  const mine = items.filter((t) => t.membership_id === session.membership.id && t.status !== "cancelled");
  const pending = items.filter((t) => t.status === "pending");
  const upcoming = items.filter((t) => t.status === "approved" && Date.parse(t.ends_at) > Date.parse(today));

  /** Offers to move the appointments a decided period covers, when there are any. */
  const offerReassign = async (timeOff: TimeOff) => {
    if (!manage) return;
    try {
      const found = await lookup(timeOff.id);
      if (found.items.length > 0) setReassign({ timeOff, items: found.items });
    } catch {
      // The lookup is a convenience; the approval itself already stands.
    }
  };

  const approve = (t: TimeOff) => {
    decide.mutate(
      { id: t.id, approve: true },
      {
        onSuccess: (saved) => {
          toast.show({ title: `Approved ${t.member_name ?? "the request"}`, tone: "success" });
          void offerReassign(saved);
        },
        onError: (thrown) => {
          toast.show({ title: apiErrorOf(thrown)?.message ?? "Couldn't approve that request.", tone: "danger" });
        },
      },
    );
  };

  const withdraw = (t: TimeOff) => {
    cancel.mutate(t.id, {
      onError: (thrown) => {
        toast.show({ title: apiErrorOf(thrown)?.message ?? "Couldn't cancel that.", tone: "danger" });
      },
    });
  };

  return (
    <div className="flex flex-col gap-6 st-to">
      <MkCard
        title="My time off"
        hint="Requests, and what has been decided. The reason you give is private to you and the owner."
        action={
          <Button
            variant="secondary"
            icon={<Plane aria-hidden="true" className="size-4" />}
            onClick={() => {
              setRequesting(true);
            }}
          >
            {manage ? "Add time off" : "Request time off"}
          </Button>
        }
      >
        {mine.length === 0 ? (
          <EmptyState title="No time off booked" description="Request time off and it will show here." />
        ) : (
          <ul className="divide-y divide-border" aria-label="My time off">
            {mine.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-bold text-text">{windowText(t, timeZone)}</p>
                  <p className="text-xs text-muted">
                    {kindLabel(t.kind)}
                    {t.reason == null || t.reason === "" ? "" : ` · ${t.reason}`}
                    {t.decision_note == null || t.decision_note === "" ? "" : ` · Note: ${t.decision_note}`}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Pill tone={TONE[t.status]}>{STATUS[t.status]}</Pill>
                  {t.status === "pending" || t.status === "approved" ? (
                    <Button
                      variant="ghost"
                      aria-label={`Cancel time off ${windowText(t, timeZone)}`}
                      disabled={cancel.isPending}
                      onClick={() => {
                        withdraw(t);
                      }}
                    >
                      Cancel
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </MkCard>

      {manage ? (
        <MkCard title="Approvals" hint="Requests waiting for you. Approving blocks the doctor's bookings for that time.">
          {pending.length === 0 ? (
            <EmptyState title="Nothing waiting" description="New requests from your team will show here." />
          ) : (
            <ul className="divide-y divide-border" aria-label="Requests waiting for approval">
              {pending.map((t) => (
                <li key={t.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-text">
                      {t.member_name ?? "A team member"} · {windowText(t, timeZone)}
                    </p>
                    <p className="text-xs text-muted">
                      {kindLabel(t.kind)}
                      {t.reason == null || t.reason === "" ? "" : ` · ${t.reason}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      aria-label={`Approve ${t.member_name ?? "request"}, ${windowText(t, timeZone)}`}
                      disabled={decide.isPending}
                      onClick={() => {
                        approve(t);
                      }}
                    >
                      Approve
                    </Button>
                    <Button
                      variant="secondary"
                      aria-label={`Decline ${t.member_name ?? "request"}, ${windowText(t, timeZone)}`}
                      disabled={decide.isPending}
                      onClick={() => {
                        setDeclining(t);
                      }}
                    >
                      Decline
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </MkCard>
      ) : null}

      {manage ? (
        <MkCard title="Away soon" hint="Approved time off. Moving the appointments it covers is one tap.">
          {upcoming.length === 0 ? (
            <EmptyState title="No one is away soon" description="Approved time off will show here." />
          ) : (
            <ul className="divide-y divide-border" aria-label="Approved time off">
              {upcoming.map((t) => (
                <li key={t.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <p className="text-sm font-bold text-text">
                    {t.member_name ?? "A team member"} · {windowText(t, timeZone)}
                  </p>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      aria-label={`Reassign appointments for ${t.member_name ?? "this person"}, ${windowText(t, timeZone)}`}
                      onClick={() => {
                        void offerReassign(t);
                      }}
                    >
                      Reassign
                    </Button>
                    <Button
                      variant="ghost"
                      aria-label={`Cancel time off for ${t.member_name ?? "this person"}, ${windowText(t, timeZone)}`}
                      disabled={cancel.isPending}
                      onClick={() => {
                        withdraw(t);
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </MkCard>
      ) : null}

      {can("settings.manage") ? <ApprovalSwitch /> : null}

      {requesting ? (
        <RequestDialog
          manage={manage}
          timeZone={timeZone}
          onOpenChange={() => {
            setRequesting(false);
          }}
          onSaved={(saved) => {
            toast.show({ title: saved.status === "approved" ? "Time off added" : "Request sent for approval", tone: "success" });
            if (saved.status === "approved") void offerReassign(saved);
          }}
        />
      ) : null}
      {declining === undefined ? null : (
        <DeclineDialog
          request={declining}
          onOpenChange={() => {
            setDeclining(undefined);
          }}
        />
      )}
      {reassign === undefined ? null : (
        <ReassignDialog
          open
          onOpenChange={() => {
            setReassign(undefined);
          }}
          appointments={reassign.items}
          personName={reassign.timeOff.member_name ?? "This person"}
          timeZone={timeZone}
        />
      )}
    </div>
  );
}

/** "Needs approval": reads and writes `staff-ops`. */
function ApprovalSwitch() {
  const ops = useStaffOps();
  const update = useUpdateStaffOps();
  const toast = useToast();
  if (ops.isPending) return <Skeleton shape="block" />;
  if (ops.isError) return <ApiErrorNotice title="Couldn't load the approval setting" error={ops.error} onRetry={() => void ops.refetch()} />;
  return (
    <MkCard title="Approval">
      <Switch
        label="Needs approval"
        hint="When on, a team member's request waits for you. When off, it is approved at once. Time off you add yourself is always approved."
        checked={ops.data.time_off.requires_approval}
        disabled={update.isPending}
        onCheckedChange={(next) => {
          update.mutate(
            { time_off: { requires_approval: next } },
            {
              onError: (thrown) => {
                toast.show({ title: apiErrorOf(thrown)?.message ?? "Couldn't change that setting.", tone: "danger" });
              },
            },
          );
        }}
      />
    </MkCard>
  );
}

function DeclineDialog({ request, onOpenChange }: { request: TimeOff; onOpenChange: () => void }) {
  const decide = useDecideTimeOff();
  const toast = useToast();
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);
  const submit = () => {
    setError(undefined);
    decide.mutate(
      { id: request.id, approve: false, ...(note.trim() === "" ? {} : { decision: { note: note.trim() } }) },
      {
        onSuccess: () => {
          toast.show({ title: "Request declined", tone: "success" });
          onOpenChange();
        },
        onError: (thrown) => {
          setError(apiErrorOf(thrown)?.message ?? "Couldn't decline that request.");
        },
      },
    );
  };
  return (
    <Dialog
      open
      onOpenChange={onOpenChange}
      title={`Decline ${request.member_name ?? "this request"}?`}
      description="They are told it was declined, with your note."
      footer={
        <>
          <Button variant="secondary" onClick={onOpenChange}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={decide.isPending}>
            {decide.isPending ? "Declining…" : "Decline request"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Note" hint="Optional, at most 200 characters">
          <TextArea
            maxLength={200}
            value={note}
            onChange={(event) => {
              setNote(event.target.value);
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

function RequestDialog({ manage, timeZone, onOpenChange, onSaved }: { manage: boolean; timeZone: string; onOpenChange: () => void; onSaved: (saved: TimeOff) => void }) {
  const today = useTodayDate();
  const staff = useStaff(manage);
  const request = useRequestTimeOff();
  const [who, setWho] = useState("me");
  const [first, setFirst] = useState(today);
  const [last, setLast] = useState(today);
  const [allDay, setAllDay] = useState(true);
  const [from, setFrom] = useState("09:00");
  const [to, setTo] = useState("13:00");
  const [kind, setKind] = useState<TimeOffKind>("vacation");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);

  const people = (staff.data?.members ?? []).filter((m) => m.status === "active");
  const badTimes = !allDay && (Number.isNaN(parseHm(from)) || Number.isNaN(parseHm(to)));
  const backwards = last < first || (!allDay && !badTimes && last === first && parseHm(to) <= parseHm(from));
  const forOther = manage && who !== "me";

  const submit = () => {
    setError(undefined);
    const body: NewTimeOff = {
      kind,
      ...(allDay ? { first_day: first, last_day: last } : { starts_at: localInstant(first, from, timeZone), ends_at: localInstant(last, to, timeZone) }),
      ...(reason.trim() === "" ? {} : { reason: reason.trim() }),
      ...(forOther ? { membership_id: who } : {}),
    };
    request.mutate(body, {
      onSuccess: (saved) => {
        onSaved(saved);
        onOpenChange();
      },
      onError: (thrown) => {
        setError(apiErrorOf(thrown)?.message ?? "Couldn't save that. Please try again.");
      },
    });
  };

  return (
    <Dialog
      open
      onOpenChange={onOpenChange}
      title={manage ? "Add time off" : "Request time off"}
      description={forOther ? "Time you add for someone else is approved at once." : manage ? "Yours is approved at once." : "Your clinic may need to approve it."}
      footer={
        <>
          <Button variant="secondary" onClick={onOpenChange}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={backwards || badTimes || request.isPending}>
            {request.isPending ? "Saving…" : forOther || manage ? "Add time off" : "Send request"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {manage ? (
          <Field label="Who">
            <Select options={[{ value: "me", label: "Me" }, ...people.map((m) => ({ value: m.id, label: m.display_name }))]} value={who} onValueChange={setWho} />
          </Field>
        ) : null}
        <div className="grid grid-cols-2 gap-4">
          <Field label="First day" required>
            <DateInput value={first} onValueChange={(value) => { setFirst(value); if (last < value) setLast(value); }} />
          </Field>
          <Field label="Last day" required>
            <DateInput value={last} min={first} onValueChange={setLast} />
          </Field>
        </div>
        <Switch label="All day" checked={allDay} onCheckedChange={setAllDay} />
        {allDay ? null : (
          <div className="grid grid-cols-2 gap-4">
            <Field label="From">
              <TextInput inputMode="numeric" placeholder="HH:MM" value={from} onChange={(event) => { setFrom(event.target.value); }} />
            </Field>
            <Field label="Until">
              <TextInput inputMode="numeric" placeholder="HH:MM" value={to} onChange={(event) => { setTo(event.target.value); }} />
            </Field>
          </div>
        )}
        <Field label="Kind">
          <Select options={KINDS} value={kind} onValueChange={setKind} />
        </Field>
        <Field label="Reason" hint="Private: only the person and the owner can see it. Never shown on the calendar.">
          <TextInput maxLength={200} value={reason} onChange={(event) => { setReason(event.target.value); }} />
        </Field>
        {backwards ? <p className="text-sm font-medium text-danger-text">The end has to be after the start.</p> : null}
        {badTimes ? <p className="text-sm font-medium text-danger-text">Enter times like 09:00.</p> : null}
        {error === undefined ? null : (
          <p role="alert" className="text-sm font-medium text-danger-text">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}
