import { useState } from "react";

import { apiErrorOf, patientNumber, type QueueToken, type ToCollectPage } from "@aarogyam/api-client";
import { formatRupees } from "@aarogyam/app-kit";
import { Button, useToast } from "@sakalya/ui";

import { useClinic } from "../../clinic.js";
import { useSetQueueStatus } from "../../queries.js";
import { COPY } from "../today/v2/copy.js";
import { CollectDialog } from "./collect-dialog.js";
import { useMarkRecallDone, useRecallsDue, useSendMissedReminder, useToCollect } from "./desk-queries.js";

type Owing = ToCollectPage["items"][number];

/** A to-collect row stands in for the token the collect dialog expects; the bill itself is found by the patient. */
function tokenOf(item: Owing): QueueToken {
  return {
    id: item.token_id,
    branch_id: "",
    day: item.day,
    token_number: item.token_number,
    patient: { id: item.patient_id, number: patientNumber.parse(item.patient_number), full_name: item.patient_number, sex: "unknown", registration_incomplete: false },
    status: "ready_to_bill",
    issued_at: `${item.day}T00:00:00.000Z`,
    wait_minutes: 0,
  };
}

/** Earlier days' unpaid bills, and the follow-ups to chase, below the board. Each shows only with the permission its API needs. */
export function DeskSections() {
  const { can } = useClinic();
  return (
    <>
      {can("payments.collect") || can("billing.read") ? <ToCollect /> : null}
      {can("patients.read") ? <FollowUps /> : null}
    </>
  );
}

function ToCollect() {
  const { can } = useClinic();
  const list = useToCollect(true);
  const setStatus = useSetQueueStatus();
  const toast = useToast();
  const [collecting, setCollecting] = useState<QueueToken | undefined>(undefined);
  const items = list.data?.items ?? [];
  if (list.data === undefined) return null;
  return (
    <section className="fd-extra" aria-labelledby="fd-to-collect">
      <h2 id="fd-to-collect">To collect ({items.length})</h2>
      {items.length === 0 ? (
        <p className="fd-empty">{COPY.nothingToCollect}</p>
      ) : (
        <ul aria-label="To collect">
          {items.map((item) => (
            <li key={item.token_id}>
              <span>
                {item.patient_number} · token #{item.token_number} · {item.day}
              </span>
              <b>{formatRupees(item.balance_paise)}</b>
              {can("payments.collect") || can("billing.write") ? (
                <Button
                  onClick={() => {
                    setCollecting(tokenOf(item));
                  }}
                >
                  Collect
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <CollectDialog
        target={collecting === undefined ? undefined : { token: collecting }}
        onClose={() => {
          setCollecting(undefined);
        }}
        onMarkDone={(token) => {
          setStatus.mutate(
            { id: token.id, change: { status: "done" } },
            {
              onSuccess: () => {
                setCollecting(undefined);
                void list.refetch();
              },
              onError: (thrown) => {
                toast.show({ title: apiErrorOf(thrown)?.message ?? "Couldn't update that token.", tone: "danger" });
              },
            },
          );
        }}
      />
    </section>
  );
}

function FollowUps() {
  const list = useRecallsDue(true);
  const done = useMarkRecallDone();
  const remind = useSendMissedReminder();
  const toast = useToast();
  if (list.data === undefined) return null;
  const items = [...list.data.items].sort((a, b) => Number(b.kind === "missed_visit") - Number(a.kind === "missed_visit"));
  return (
    <section className="fd-extra" aria-labelledby="fd-follow-ups">
      <h2 id="fd-follow-ups">Follow-ups ({items.length})</h2>
      {items.length === 0 ? (
        <p className="fd-empty">{COPY.noFollowUps}</p>
      ) : (
        <ul aria-label="Follow-ups">
          {items.map((r) => (
            <li key={r.id}>
              <span>
                <b>{r.patient.name}</b> · {r.kind === "missed_visit" ? "Missed visit" : r.reason} · due {r.due_on}
              </span>
              <Button
                variant="secondary"
                disabled={remind.isPending}
                aria-label={`Send reminder to ${r.patient.name}`}
                onClick={() => {
                  remind.mutate(r.patient.id);
                }}
              >
                Send reminder
              </Button>
              <Button
                variant="ghost"
                disabled={done.isPending}
                aria-label={`Done: ${r.patient.name}`}
                onClick={() => {
                  done.mutate(r.id, {
                    onError: (thrown) => {
                      toast.show({ title: apiErrorOf(thrown)?.message ?? "Couldn't mark that done.", tone: "danger" });
                    },
                  });
                }}
              >
                Done
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
