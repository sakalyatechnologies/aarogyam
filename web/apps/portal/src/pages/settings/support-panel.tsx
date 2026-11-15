import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useSyncExternalStore } from "react";

import { apiErrorOf, unwrap, type SupportGrantView } from "@aarogyam/api-client";
import { ApiErrorNotice, formatDateTime, formatTime } from "@aarogyam/app-kit";
import { Button, Dialog, Field, TextArea, TextInput, useToast } from "@sakalya/ui";

import { useClinic } from "../../clinic.js";
import { EmptyState, MkCard, Segments, StatusChip } from "../../components/mk/index.js";
import { SkeletonRows } from "../../components/skeleton-rows.js";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** How long access lasts: the API allows 15 minutes to 7 days. */
const LENGTHS = [
  { value: "1h", label: "1 hour", ms: HOUR },
  { value: "1d", label: "1 day", ms: DAY },
  { value: "3d", label: "3 days", ms: 3 * DAY },
  { value: "7d", label: "7 days", ms: 7 * DAY },
] as const;
type LengthKey = (typeof LENGTHS)[number]["value"];

// ---------------------------------------------------------------------------------------------
// Data

function useGrantKey() {
  const { access } = useClinic();
  return ["support-grants", access.org_id] as const;
}

function useGrants() {
  const { api } = useClinic();
  const key = useGrantKey();
  return useQuery({ queryKey: [...key, "list"], queryFn: ({ signal }) => unwrap(api.listSupportGrants({ signal })) });
}

function useGrantActions(id: string, enabled: boolean) {
  const { api } = useClinic();
  const key = useGrantKey();
  return useQuery({ queryKey: [...key, "actions", id], queryFn: ({ signal }) => unwrap(api.listSupportGrantActions(id, { signal })), enabled });
}

function useGive() {
  const { api } = useClinic();
  const key = useGrantKey();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { staff_email: string; reason: string; ends_at: string }) => unwrap(api.createSupportGrant(input)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key }),
  });
}

function useRevoke() {
  const { api } = useClinic();
  const key = useGrantKey();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => unwrap(api.revokeSupportGrant(id)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key }),
  });
}

/** The minute now, through the external-store hook so rendering stays pure and "ends in" keeps counting down. */
function useMinute(): number {
  const subscribe = (notify: () => void) => {
    const timer = setInterval(notify, 30_000);
    return () => { clearInterval(timer); };
  };
  const read = () => Math.floor(Date.now() / MINUTE);
  return useSyncExternalStore(subscribe, read, read);
}

/** `45 min`, `5 h 10 min`, `2 days 3 h`. */
function remaining(ms: number): string {
  const minutes = Math.max(1, Math.ceil(ms / MINUTE));
  const h = String(Math.floor((minutes % (24 * 60)) / 60));
  if (minutes < 60) return `${String(minutes)} min`;
  if (minutes < 48 * 60) return `${String(Math.floor(minutes / 60))} h ${String(minutes % 60)} min`;
  return `${String(Math.floor(minutes / (24 * 60)))} days ${h} h`;
}

const who = (g: SupportGrantView) => g.staff_name ?? g.staff_email ?? "Sakalya staff";

// ---------------------------------------------------------------------------------------------
// Panel

/** Settings → Support access: lets Sakalya staff read the clinic's records for a limited time, and shows what they opened. */
export function SupportPanel() {
  const list = useGrants();
  if (list.isPending) return <SkeletonRows label="Loading support access" />;
  if (list.isError) return <ApiErrorNotice title="Couldn't load support access" error={list.error} onRetry={() => void list.refetch()} />;
  const active = list.data.items.filter((g) => g.status === "active");
  const past = list.data.items.filter((g) => g.status !== "active");
  return (
    <div className="flex flex-col gap-6 st-support">
      <MkCard title="Active access" hint="Sakalya staff who can read your records right now.">
        {active.length === 0 ? (
          <EmptyState title="No one has access" description="Sakalya staff can't read your records unless you give access below." />
        ) : (
          <ul className="divide-y divide-border" aria-label="Active access">
            {active.map((g) => (
              <GrantRow key={g.id} grant={g} />
            ))}
          </ul>
        )}
      </MkCard>
      <GiveAccess />
      {past.length === 0 ? null : <PastGrants grants={past} />}
    </div>
  );
}

function GrantRow({ grant }: { grant: SupportGrantView }) {
  const { session } = useClinic();
  const timeZone = session.clinic.timezone;
  const minute = useMinute();
  const [open, setOpen] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const left = Date.parse(grant.ends_at) - minute * MINUTE;
  return (
    <li className="flex flex-col gap-2 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="m-0 text-sm font-bold text-text">{who(grant)}</p>
          <p className="m-0 text-xs text-muted">{grant.reason}</p>
          <p className="m-0 text-xs text-muted">
            Ends in {remaining(left)} · {formatDateTime(grant.ends_at, timeZone)}
          </p>
        </div>
        <div className="flex gap-2">
          <ActionsToggle grant={grant} open={open} onToggle={() => { setOpen(!open); }} />
          <Button variant="secondary" aria-label={`Revoke access for ${who(grant)}`} onClick={() => { setRevoking(true); }}>
            Revoke
          </Button>
        </div>
      </div>
      {open ? <ActionList grant={grant} /> : null}
      {revoking ? <RevokeDialog grant={grant} onClose={() => { setRevoking(false); }} /> : null}
    </li>
  );
}

function ActionsToggle({ grant, open, onToggle }: { grant: SupportGrantView; open: boolean; onToggle: () => void }) {
  return (
    <Button variant="ghost" aria-expanded={open} aria-label={`What they looked at (${String(grant.actions)}) for ${who(grant)}`} onClick={onToggle}>
      What they looked at ({grant.actions})
    </Button>
  );
}

function RevokeDialog({ grant, onClose }: { grant: SupportGrantView; onClose: () => void }) {
  const revoke = useRevoke();
  const toast = useToast();
  const [error, setError] = useState<string | undefined>(undefined);
  const submit = () => {
    setError(undefined);
    revoke.mutate(grant.id, {
      onSuccess: () => {
        toast.show({ title: `Access ended for ${who(grant)}`, tone: "success" });
        onClose();
      },
      onError: (thrown) => { setError(apiErrorOf(thrown)?.message ?? "Couldn't end that access."); },
    });
  };
  return (
    <Dialog
      open
      onOpenChange={onClose}
      title={`End access for ${who(grant)}?`}
      description="They can't read your records from now on. What they already opened stays in the list."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Keep access
          </Button>
          <Button onClick={submit} disabled={revoke.isPending}>
            {revoke.isPending ? "Ending…" : "Revoke access"}
          </Button>
        </>
      }
    >
      {error === undefined ? null : <p role="alert" className="m-0 text-sm text-danger-text">{error}</p>}
    </Dialog>
  );
}

/** What they opened: the route templates the API keeps (`/api/v1/patients/{id}`), never a patient's details. */
function ActionList({ grant }: { grant: SupportGrantView }) {
  const { session } = useClinic();
  const timeZone = session.clinic.timezone;
  const actions = useGrantActions(grant.id, true);
  if (actions.isPending) return <SkeletonRows count={2} label="Loading what they looked at" />;
  if (actions.isError) return <ApiErrorNotice title="Couldn't load what they looked at" error={actions.error} onRetry={() => void actions.refetch()} />;
  if (actions.data.items.length === 0) return <p className="m-0 text-xs text-muted">They have not opened anything yet.</p>;
  return (
    <ul className="m-0 flex list-none flex-col gap-1 p-0 text-xs" aria-label={`What ${who(grant)} looked at`}>
      {actions.data.items.map((a, index) => (
        <li key={`${a.at}-${String(index)}`} className="flex flex-wrap gap-x-3">
          <span className="text-muted">{formatDateTime(a.at, timeZone)}</span>
          <span className="font-bold text-text">{a.method}</span>
          <code className="text-text">{a.route}</code>
        </li>
      ))}
    </ul>
  );
}

function PastGrants({ grants }: { grants: SupportGrantView[] }) {
  return (
    <MkCard>
      <details>
        <summary className="cursor-pointer text-sm font-bold text-text">Past access ({grants.length})</summary>
        <ul className="divide-y divide-border" aria-label="Past access">
          {grants.map((g) => (
            <PastRow key={g.id} grant={g} />
          ))}
        </ul>
      </details>
    </MkCard>
  );
}

function PastRow({ grant }: { grant: SupportGrantView }) {
  const { session } = useClinic();
  const timeZone = session.clinic.timezone;
  const [open, setOpen] = useState(false);
  const stopped = grant.status === "revoked" && grant.revoked_at != null ? `Revoked ${formatDateTime(grant.revoked_at, timeZone)}` : `Ended ${formatDateTime(grant.ends_at, timeZone)}`;
  return (
    <li className="flex flex-col gap-2 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="m-0 text-sm font-bold text-text">
            {who(grant)} <StatusChip tone="done">{grant.status === "revoked" ? "Revoked" : "Ended"}</StatusChip>
          </p>
          <p className="m-0 text-xs text-muted">{grant.reason}</p>
          <p className="m-0 text-xs text-muted">{formatDateTime(grant.starts_at, timeZone)} to {formatTime(grant.ends_at, timeZone)} · {stopped}</p>
        </div>
        <ActionsToggle grant={grant} open={open} onToggle={() => { setOpen(!open); }} />
      </div>
      {open ? <ActionList grant={grant} /> : null}
    </li>
  );
}

function GiveAccess() {
  const give = useGive();
  const toast = useToast();
  const [email, setEmail] = useState("");
  const [reason, setReason] = useState("");
  const [length, setLength] = useState<LengthKey>("1d");
  const [errors, setErrors] = useState<{ email?: string; reason?: string; form?: string }>({});
  const submit = () => {
    const trimmed = reason.trim();
    const next = {
      ...(email.trim() === "" ? { email: "Enter their Sakalya sign-in email." } : {}),
      ...(trimmed.length < 3 || trimmed.length > 500 ? { reason: "Give a reason of 3 to 500 characters." } : {}),
    };
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    const ms = LENGTHS.find((l) => l.value === length)?.ms ?? HOUR;
    give.mutate(
      { staff_email: email.trim(), reason: trimmed, ends_at: new Date(Date.now() + ms).toISOString() },
      {
        onSuccess: (grant) => {
          toast.show({ title: `${who(grant)} can read your records`, tone: "success" });
          setEmail("");
          setReason("");
        },
        onError: (thrown) => { setErrors({ form: apiErrorOf(thrown)?.message ?? "Couldn't give access." }); },
      },
    );
  };
  return (
    <MkCard title="Give access" hint="Read-only. It starts now. Every page they open is logged, and you can see the list here.">
      <form
        className="flex flex-col gap-4"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <Field label="Staff email" hint="Their Sakalya sign-in email" error={errors.email}>
          <TextInput type="email" value={email} onChange={(event) => { setEmail(event.target.value); }} />
        </Field>
        <Field label="Reason" hint="3 to 500 characters. Do not write patient details." error={errors.reason}>
          <TextArea value={reason} maxLength={500} rows={3} onChange={(event) => { setReason(event.target.value); }} />
        </Field>
        <Segments label="How long" options={LENGTHS} value={length} onChange={setLength} />
        {errors.form === undefined ? null : <p role="alert" className="m-0 text-sm text-danger-text">{errors.form}</p>}
        <div>
          <Button type="submit" disabled={give.isPending}>
            {give.isPending ? "Giving access…" : "Give access"}
          </Button>
        </div>
      </form>
    </MkCard>
  );
}
