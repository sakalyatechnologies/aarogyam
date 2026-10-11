import { Armchair, CalendarCheck, CheckCircle2, Clock3, Footprints, Plus } from "lucide-react";
import { useState } from "react";

import { apiErrorOf, type QueueToken, type RoomId } from "@aarogyam/api-client";
import { ApiErrorNotice, useDocumentTitle } from "@aarogyam/app-kit";
import { Badge, Button, PageHeader, useToast } from "@sakalya/ui";

import { useClinic } from "../../clinic.js";
import { StartVisitButton } from "../../components/start-visit-button.js";
import { EmptyState, Skeleton } from "../../components/mk/index.js";
import { ageSex, patientPath } from "../../lib/patients.js";
import { usePractitioners, useQueue, useRooms, useSetQueueStatus } from "../../queries.js";
import { AddToQueue } from "./add-to-queue.js";
import { ChairDialog } from "./chair-dialog.js";
import { CollectDialog } from "./collect-dialog.js";
import { useCallToken } from "./queue-v2-queries.js";
import "./queue-v2.css";

type Column = "waiting" | "called" | "in_chair" | "ready_to_bill" | "done";

const COLUMNS: readonly { key: Column; title: string; icon: typeof Clock3; empty: string }[] = [
  { key: "waiting", title: "Waiting", icon: Clock3, empty: "Nobody is waiting." },
  { key: "called", title: "Called", icon: Footprints, empty: "Nobody has been called." },
  { key: "in_chair", title: "In chair", icon: Armchair, empty: "No chairs in use." },
  { key: "ready_to_bill", title: "Ready to bill", icon: CalendarCheck, empty: "Nothing to bill." },
  { key: "done", title: "Done", icon: CheckCircle2, empty: "Nobody has finished yet." },
];

/** A booked patient has an appointment behind the token; a walk-in does not. */
export function isWalkIn(token: Pick<QueueToken, "appointment_id">): boolean {
  return token.appointment_id == null;
}

/** Front desk (New look): the day's tokens as a board, one column per step, with the next step on each card. */
export function QueueV2() {
  const { session, can } = useClinic();
  useDocumentTitle("Front desk", session.clinic.name);
  const queue = useQueue();
  const practitioners = usePractitioners();
  const rooms = useRooms();
  const setStatus = useSetQueueStatus();
  const call = useCallToken();
  const toast = useToast();
  const canWrite = can("appointments.write");
  const canCall = can("clinical.write");
  const canBill = can("billing.write");
  const [adding, setAdding] = useState(false);
  const [seating, setSeating] = useState<QueueToken | undefined>(undefined);
  const [collecting, setCollecting] = useState<QueueToken | undefined>(undefined);

  const items = queue.data?.items ?? [];
  const inColumn = (key: Column) =>
    items
      .filter((t) => (key === "done" ? t.status === "done" || t.status === "left" : t.status === key))
      .sort((a, b) => (key === "done" ? b.token_number - a.token_number : a.token_number - b.token_number));
  const roomName = (id: string | null | undefined) => rooms.data?.items.find((r) => r.id === id)?.name;

  const fail = (thrown: unknown) => {
    toast.show({ title: apiErrorOf(thrown)?.message ?? "Couldn't update that token.", tone: "danger" });
  };
  const move = (token: QueueToken, status: "ready_to_bill" | "done" | "left", after?: () => void) => {
    setStatus.mutate(
      { id: token.id, change: { status } },
      {
        onSuccess: () => {
          after?.();
        },
        onError: fail,
      },
    );
  };
  const seat = (roomId: RoomId) => {
    if (seating === undefined) return;
    setStatus.mutate(
      { id: seating.id, change: { status: "in_chair", room_id: roomId } },
      {
        onSuccess: () => {
          setSeating(undefined);
        },
        onError: fail,
      },
    );
  };
  const busy = setStatus.isPending || call.isPending;

  const actions = (token: QueueToken) => {
    if (!canWrite) return null;
    switch (token.status) {
      case "waiting":
        return (
          <>
            {canCall ? (
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => {
                  call.mutate(token.id, { onError: fail });
                }}
              >
                Call
              </Button>
            ) : null}
            <Button
              disabled={busy}
              onClick={() => {
                setSeating(token);
              }}
            >
              To chair
            </Button>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => {
                move(token, "left");
              }}
            >
              Left
            </Button>
          </>
        );
      case "called":
        return (
          <>
            <Button
              disabled={busy}
              onClick={() => {
                setSeating(token);
              }}
            >
              To chair
            </Button>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => {
                move(token, "left");
              }}
            >
              Left
            </Button>
          </>
        );
      case "in_chair":
        return (
          <>
            <Button
              disabled={busy}
              onClick={() => {
                move(token, "ready_to_bill");
              }}
            >
              Ready to bill
            </Button>
            <StartVisitButton tokenId={token.id} variant="secondary" label="Open visit" />
          </>
        );
      case "ready_to_bill":
        return (
          <>
            {canBill ? (
              <Button
                onClick={() => {
                  setCollecting(token);
                }}
              >
                Collect
              </Button>
            ) : null}
            <Button
              variant={canBill ? "secondary" : "primary"}
              disabled={busy}
              onClick={() => {
                move(token, "done");
              }}
            >
              Done
            </Button>
          </>
        );
      default:
        return null;
    }
  };

  return (
    <div className="mk-panel fd">
      <PageHeader
        variant="display"
        title="Front desk"
        subtitle={
          queue.data === undefined
            ? "Add patients, run the queue, take payments."
            : `${String(inColumn("waiting").length)} waiting · ${String(inColumn("in_chair").length)} in chair · ${String(inColumn("ready_to_bill").length)} to bill`
        }
        end={
          canWrite ? (
            <Button
              icon={<Plus aria-hidden="true" className="size-4" />}
              onClick={() => {
                setAdding(true);
              }}
            >
              Add to queue
            </Button>
          ) : undefined
        }
      />
      {queue.isPending ? (
        <div role="status" aria-label="Loading the queue" className="fd-board">
          {COLUMNS.map((c) => (
            <Skeleton key={c.key} shape="block" style={{ height: 280 }} />
          ))}
        </div>
      ) : queue.isError ? (
        apiErrorOf(queue.error)?.status === 404 ? (
          <EmptyState art="queue" title="The queue isn't connected yet" description="Tokens appear here once the API serves the queue." />
        ) : (
          <ApiErrorNotice title="Couldn't load the queue" error={queue.error} onRetry={() => void queue.refetch()} />
        )
      ) : (
        <div className="fd-board">
          {COLUMNS.map(({ key, title, icon: Icon, empty }) => {
            const tokens = inColumn(key);
            return (
              <section key={key} className="fd-col" aria-labelledby={`fd-${key}`}>
                <h2 id={`fd-${key}`}>
                  <Icon aria-hidden="true" className="size-4" />
                  {title}
                  <span className="fd-count" aria-label={`${String(tokens.length)} ${tokens.length === 1 ? "patient" : "patients"}`}>
                    {tokens.length}
                  </span>
                </h2>
                {tokens.length === 0 ? (
                  <p className="fd-empty">{empty}</p>
                ) : (
                  <ul>
                    {(key === "done" ? tokens.slice(0, 20) : tokens).map((token) => (
                      <li key={token.id} className="fd-card" aria-label={`Token ${String(token.token_number)}, ${token.patient.full_name}`}>
                        <div className="fd-card-top">
                          <span className="fd-tok">#{token.token_number}</span>
                          {isWalkIn(token) ? <Badge tone="warning">Walk-in (no booking)</Badge> : <Badge tone="info">Booked</Badge>}
                        </div>
                        <a href={patientPath(token.patient)} className="fd-name">
                          {token.patient.full_name}
                        </a>
                        <p className="fd-meta">
                          {token.patient.number} · {ageSex(token.patient.age_years, token.patient.sex)}
                          {token.practitioner == null ? "" : ` · ${token.practitioner.display_name}`}
                        </p>
                        <p className="fd-facts">
                          <span>
                            <Clock3 aria-hidden="true" className="size-3.5" />
                            {token.status === "waiting" ? `Waiting ${String(token.wait_minutes)} min` : token.status === "left" ? "Left" : `Waited ${String(token.wait_minutes)} min`}
                          </span>
                          {roomName(token.room_id) === undefined ? null : (
                            <span>
                              <Armchair aria-hidden="true" className="size-3.5" />
                              {roomName(token.room_id)}
                            </span>
                          )}
                        </p>
                        <div className="fd-actions">{actions(token)}</div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      )}
      <AddToQueue open={adding} onOpenChange={setAdding} day={queue.data?.date ?? ""} practitioners={practitioners.data?.items ?? []} />
      <ChairDialog
        patientName={seating?.patient.full_name}
        rooms={(rooms.data?.items ?? []).filter((r) => r.active && (seating === undefined || r.branch_id === seating.branch_id))}
        busy={setStatus.isPending}
        onPick={seat}
        onClose={() => {
          setSeating(undefined);
        }}
      />
      <CollectDialog
        token={collecting}
        onClose={() => {
          setCollecting(undefined);
        }}
        onMarkDone={(token) => {
          move(token, "done", () => {
            setCollecting(undefined);
          });
        }}
      />
    </div>
  );
}
