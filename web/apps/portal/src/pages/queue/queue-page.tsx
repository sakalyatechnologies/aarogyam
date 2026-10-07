import { Armchair, CheckCircle2, Clock3, LogOut, Plus, UserRoundPlus } from "lucide-react";
import { useState } from "react";

import { apiErrorOf, type Patient, type QueueToken } from "@aarogyam/api-client";
import { ApiErrorNotice, useDocumentTitle } from "@aarogyam/app-kit";
import { Avatar, Button, Dialog, Field, Select, useToast } from "@sakalya/ui";

import { PatientPicker } from "../../components/patient-picker.js";
import { useClinic } from "../../clinic.js";
import { ageSex, patientPath } from "../../lib/patients.js";
import { useAddWalkIn, usePractitioners, useQueue, useSetQueueStatus } from "../../queries.js";
import { Empty, EmptyState, MkCard, PageHeader, Skeleton, StatTile, StatusChip } from "../../components/mk/index.js";

/** Today's waiting room: wait times, walk-ins and moving tokens along. Built for a tablet at the counter. */
export function QueuePage() {
  const { session, can } = useClinic();
  useDocumentTitle("Queue", session.clinic.name);
  const queue = useQueue();
  const practitioners = usePractitioners();
  const canWrite = can("appointments.write");
  const [walkInOpen, setWalkInOpen] = useState(false);

  const waiting = (queue.data?.items ?? []).filter((t) => t.status === "waiting").sort((a, b) => a.token_number - b.token_number);
  const inChair = (queue.data?.items ?? []).filter((t) => t.status === "in_chair").sort((a, b) => a.token_number - b.token_number);
  const resolved = (queue.data?.items ?? [])
    .filter((t) => t.status === "done" || t.status === "left")
    .sort((a, b) => b.token_number - a.token_number);

  return (
    <>
      <PageHeader
        eyebrow={queue.data === undefined ? "Waiting room" : `Waiting room · ${new Date(`${queue.data.date}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" })}`}
        title="Queue"
        subtitle={queue.data === undefined ? "Wait times, walk-ins and who is in the chair." : `${String(waiting.length)} waiting · ${String(inChair.length)} in the chair · ${String(resolved.length)} seen today`}
        end={
          canWrite ? (
            <Button
              icon={<UserRoundPlus aria-hidden="true" className="size-4" />}
              onClick={() => {
                setWalkInOpen(true);
              }}
            >
              Walk-in
            </Button>
          ) : undefined
        }
      />
      {queue.isPending ? (
        <div role="status" aria-label="Loading the queue" className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {Array.from({ length: 3 }, (_, index) => (
            <Skeleton key={index} shape="block" style={{ height: 260 }} />
          ))}
        </div>
      ) : queue.isError ? (
        apiErrorOf(queue.error)?.status === 404 ? (
          <EmptyState art="queue" title="The queue isn't connected yet" description="Tokens appear here once the API serves the queue." />
        ) : (
          <ApiErrorNotice title="Couldn't load the queue" error={queue.error} onRetry={() => void queue.refetch()} />
        )
      ) : (
        <>
          <div className="mk-stats">
            <StatTile label="Waiting" value={waiting.length} tone="warn" icon={<Clock3 />} />
            <StatTile label="In the chair" value={inChair.length} icon={<Armchair />} />
            <StatTile label="Seen today" value={resolved.filter((t) => t.status === "done").length} icon={<CheckCircle2 />} />
            <StatTile
              label="Longest wait"
              value={waiting.length === 0 ? "—" : `${String(Math.max(...waiting.map((t) => t.wait_minutes)))} min`}
              icon={<Clock3 />}
              trend={waiting.some((t) => t.wait_minutes >= 30) ? { direction: "up", text: "Over 30 min", good: false } : undefined}
            />
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <QueueColumn
              title="Waiting"
              tone="warning"
              tokens={waiting}
              canWrite={canWrite}
              empty={{ title: "Nobody is waiting", text: canWrite ? "Add a walk-in, or check people in from Today." : "Arrivals show here as they check in." }}
            />
            <QueueColumn title="In the chair" tone="primary" tokens={inChair} canWrite={canWrite} empty={{ title: "No chairs in use", text: "Seat a waiting patient to start their visit." }} />
            <QueueColumn title="Done today" tone="success" tokens={resolved.slice(0, 15)} canWrite={false} empty={{ title: "Nobody has been seen yet", text: "Finished visits collect here through the day." }} />
          </div>
        </>
      )}
      <WalkInDialog open={walkInOpen} onOpenChange={setWalkInOpen} practitioners={practitioners.data?.items ?? []} />
    </>
  );
}

function QueueColumn({
  title,
  tone,
  tokens,
  canWrite,
  empty,
}: {
  title: string;
  tone: "warning" | "primary" | "success";
  tokens: readonly QueueToken[];
  canWrite: boolean;
  empty: { title: string; text: string };
}) {
  return (
    <MkCard title={`${title} (${String(tokens.length)})`}>
      {tokens.length === 0 ? (
        <Empty art={tone === "success" ? "clear" : "queue"} title={empty.title}>
          {empty.text}
        </Empty>
      ) : (
        <ul className="flex flex-col gap-3" style={{ marginTop: 12 }}>
          {tokens.map((token) => (
            <QueueRow key={token.id} token={token} tone={tone} canWrite={canWrite} />
          ))}
        </ul>
      )}
    </MkCard>
  );
}

function QueueRow({ token, tone, canWrite }: { token: QueueToken; tone: "warning" | "primary" | "success"; canWrite: boolean }) {
  const toast = useToast();
  const setStatus = useSetQueueStatus();

  const move = (status: "in_chair" | "done" | "left") => {
    setStatus.mutate(
      { id: token.id, change: { status } },
      {
        onError: (thrown) => {
          toast.show({ title: apiErrorOf(thrown)?.message ?? "Couldn't update that token.", tone: "danger" });
        },
      },
    );
  };

  return (
    <li className="mk-qrow">
      <span className="mk-qtok" aria-label={`Token ${String(token.token_number)}`}>
        #{token.token_number}
      </span>
      <div className="min-w-0 flex-1">
        <a href={patientPath(token.patient)} className="block truncate text-sm font-bold text-text hover:underline">
          {token.patient.full_name}
        </a>
        <p className="truncate text-xs text-muted">
          {token.patient.number} · {ageSex(token.patient.age_years, token.patient.sex)}
          {token.practitioner == null ? "" : ` · ${token.practitioner.display_name}`}
        </p>
        <span style={{ display: "inline-block", marginTop: 4 }}>
          <StatusChip tone={token.status === "done" || token.status === "left" ? "done" : tone === "primary" ? "ready" : token.wait_minutes >= 30 ? "noshow" : "waiting"}>
            <Clock3 aria-hidden="true" className="size-3.5" />
            {token.status === "done" ? "Completed" : token.status === "left" ? "Left" : `Waiting ${String(token.wait_minutes)} min`}
          </StatusChip>
        </span>
      </div>
      {canWrite ? (
        <div className="flex shrink-0 flex-col gap-1.5">
          {token.status === "waiting" ? (
            <Button
              variant="secondary"
              icon={<Armchair aria-hidden="true" className="size-4" />}
              disabled={setStatus.isPending}
              onClick={() => {
                move("in_chair");
              }}
            >
              Seat
            </Button>
          ) : null}
          {token.status === "in_chair" ? (
            <Button
              icon={<CheckCircle2 aria-hidden="true" className="size-4" />}
              disabled={setStatus.isPending}
              onClick={() => {
                move("done");
              }}
            >
              Done
            </Button>
          ) : null}
          {token.status === "waiting" ? (
            <Button
              variant="ghost"
              icon={<LogOut aria-hidden="true" className="size-4" />}
              disabled={setStatus.isPending}
              onClick={() => {
                move("left");
              }}
            >
              Left
            </Button>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function WalkInDialog({
  open,
  onOpenChange,
  practitioners,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  practitioners: readonly { id: string; display_name: string }[];
}) {
  const [patient, setPatient] = useState<Patient | undefined>(undefined);
  const [practitionerId, setPractitionerId] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);
  const addWalkIn = useAddWalkIn();
  const toast = useToast();

  const close = () => {
    onOpenChange(false);
    setPatient(undefined);
    setPractitionerId("");
    setError(undefined);
  };

  const submit = () => {
    if (patient === undefined) {
      return;
    }
    setError(undefined);
    addWalkIn.mutate(
      { patient_id: patient.id, ...(practitionerId === "" ? {} : { practitioner_id: practitionerId }) },
      {
        onSuccess: (token) => {
          toast.show({ title: `Issued token #${String(token.token_number)}`, tone: "success" });
          close();
        },
        onError: (thrown) => {
          setError(apiErrorOf(thrown)?.message ?? "Couldn't issue a token. Please try again.");
        },
      },
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
      title="Walk-in"
      description="Issue a queue token to a patient without an appointment."
      dismissOnOutsidePress={false}
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={patient === undefined || addWalkIn.isPending}>
            {addWalkIn.isPending ? "Issuing…" : "Issue token"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {patient === undefined ? (
          <PatientPicker onChoose={setPatient} />
        ) : (
          <div className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-surface-muted px-4 py-3">
            <span className="flex items-center gap-3">
              <Avatar name={patient.full_name} size="sm" />
              <span>
                <span className="block text-sm font-bold text-text">{patient.full_name}</span>
                <span className="block text-xs text-muted">{patient.number}</span>
              </span>
            </span>
            <Button
              variant="ghost"
              icon={<Plus aria-hidden="true" className="size-4 rotate-45" />}
              onClick={() => {
                setPatient(undefined);
              }}
            >
              Change
            </Button>
          </div>
        )}
        <Field label="Doctor" hint="Optional">
          <Select
            options={practitioners.map((p) => ({ value: p.id, label: p.display_name }))}
            value={practitionerId}
            onValueChange={setPractitionerId}
            placeholder="Not yet known"
          />
        </Field>
        {error === undefined ? null : (
          <p role="alert" className="rounded-xl bg-danger-soft px-4 py-3 text-sm font-medium text-danger-text">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}
