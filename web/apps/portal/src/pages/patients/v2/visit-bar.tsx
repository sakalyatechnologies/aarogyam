import { Check, Cloud, CloudOff, Printer, Send, Stethoscope, Timer, Wallet } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";

import { unwrap } from "@aarogyam/api-client";
import { Dialog, Field, TextArea } from "@sakalya/ui";

import { useClinic } from "../../../clinic.js";
import { useSetQueueStatus } from "../../../queries.js";
import { usePrescriptions } from "../../prescriptions/queries.js";
import { CollectPanel } from "./collect-panel.js";
import { PillButton } from "./kit.js";
import "./p360.css";
import { useVisitSession, type FinishOptions } from "./visit-session.js";

/** Whether the browser has a connection. Nothing in this screen claims to be saved while it is false. */
export function useOnline(): boolean {
  const [online, setOnline] = useState(() => globalThis.navigator.onLine);
  useEffect(() => {
    const up = () => {
      setOnline(true);
    };
    const down = () => {
      setOnline(false);
    };
    globalThis.addEventListener("online", up);
    globalThis.addEventListener("offline", down);
    return () => {
      globalThis.removeEventListener("online", up);
      globalThis.removeEventListener("offline", down);
    };
  }, []);
  return online;
}

/** `mm:ss`, or `h:mm:ss` past an hour. */
export function elapsed(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${String(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/** The running visit time, counted from when the visit started on the server. */
function VisitTimer({ startedAt }: { startedAt: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      clearInterval(id);
    };
  }, []);
  return (
    <span className="p360-timer" role="timer" aria-label="Visit time">
      <Timer aria-hidden="true" />
      {elapsed((now - new Date(startedAt).getTime()) / 1000)}
    </span>
  );
}

/**
 * The visit bar, pinned to the top of every layout, with one main button that follows the visit: Start visit, End visit,
 * then Send for payment or Collect payment, then the celebration. Ending goes through `finishVisit` (see
 * finish-visit.ts): one request signs the note, issues the draft when asked, and closes the visit.
 */
export function VisitBar() {
  const session = useVisitSession();
  const { api, can } = useClinic();
  const online = useOnline();
  const navigate = useNavigate();
  const setQueueStatus = useSetQueueStatus();
  const [confirming, setConfirming] = useState(false);
  const [collecting, setCollecting] = useState(false);
  const [sending, setSending] = useState(false);
  const [reason, setReason] = useState("");
  const prescriptions = usePrescriptions(session.canRx ? session.patientId : undefined);
  if (!session.canWrite) return null;

  const { visit, rx, ended, voice } = session;
  const canBill = can("billing.write");
  const latestIssued =
    rx.issued?.rx ?? [...(prescriptions.data?.items ?? [])].filter((r) => r.status === "issued").sort((a, b) => (b.issued_at ?? "").localeCompare(a.issued_at ?? ""))[0];
  const medicines = rx.draft?.items.length ?? 0;

  const run = (options?: FinishOptions) => {
    setConfirming(false);
    void session.finish(options).then((finished) => {
      if (finished !== undefined) setReason("");
    });
  };

  // The patient's open token goes to "ready to bill" so the desk sees who is waiting to pay. Best effort: a visit started from
  // the queue has already finished its token, and a role without appointments.write cannot move one.
  const sendForPayment = async () => {
    setSending(true);
    try {
      if (can("appointments.read") && can("appointments.write")) {
        const queue = await unwrap(api.listQueue(undefined)).catch(() => undefined);
        const token = queue?.items.find((t) => t.patient.id === session.patientId && ["waiting", "called", "in_chair"].includes(t.status));
        if (token !== undefined) {
          if (token.status !== "in_chair") await setQueueStatus.mutateAsync({ id: token.id, change: { status: "in_chair" } });
          await setQueueStatus.mutateAsync({ id: token.id, change: { status: "ready_to_bill" } });
        }
      }
    } catch {
      // The celebration and the bill carry on; the desk can still find the visit.
    } finally {
      setSending(false);
      session.celebrate();
    }
  };

  return (
    <>
      <div className="p360-bar" role="region" aria-label="Visit actions">
        <span className={`p360-net ${online ? "" : "off"}`} role="status">
          {online ? <Cloud aria-hidden="true" /> : <CloudOff aria-hidden="true" />}
          {online ? "Online" : "No connection. Nothing is saved until it returns."}
        </span>
        {visit === undefined || ended !== undefined ? (
          <span className="p360-sum">{ended === undefined ? "No open visit" : "Visit ended"}</span>
        ) : (
          <VisitTimer startedAt={visit.started_at} />
        )}
        {voice.busy && ended === undefined && visit !== undefined ? <span className="p360-sum">Save the voice note before ending the visit.</span> : null}
        <div className="p360-act">
          {session.canRx ? (
            <PillButton
              variant="ghost"
              icon={<Printer aria-hidden="true" />}
              disabled={latestIssued === undefined}
              onClick={() => {
                if (latestIssued !== undefined) void navigate(`/prescriptions/${latestIssued.id}/print`, { state: { pin: rx.issued?.message.pin ?? null } });
              }}
            >
              Print Rx
            </PillButton>
          ) : null}
          {ended !== undefined ? (
            <>
              {canBill ? (
                <PillButton
                  icon={<Wallet aria-hidden="true" />}
                  disabled={session.celebrating}
                  onClick={() => {
                    setCollecting(true);
                  }}
                >
                  Collect payment
                </PillButton>
              ) : null}
              <PillButton
                variant={canBill ? "ghost" : "primary"}
                icon={<Send aria-hidden="true" />}
                disabled={sending || session.celebrating}
                onClick={() => void sendForPayment()}
              >
                {sending ? "Sending…" : "Send for payment"}
              </PillButton>
            </>
          ) : visit === undefined ? (
            <PillButton icon={<Stethoscope aria-hidden="true" />} disabled={session.starting || session.visitLoading} onClick={session.startVisit}>
              {session.starting ? "Starting…" : "Start visit"}
            </PillButton>
          ) : (
            <PillButton
              icon={<Check aria-hidden="true" />}
              disabled={!online || session.finishing || voice.busy}
              onClick={() => {
                if (medicines > 0 && rx.draft !== undefined) {
                  setConfirming(true);
                } else {
                  run();
                }
              }}
            >
              {session.finishing ? "Ending…" : "End visit"}
            </PillButton>
          )}
        </div>
      </div>
      {session.error === undefined || session.visit === undefined ? null : (
        <p role="alert" className="mk-hint" style={{ color: "var(--red)", margin: 0 }}>
          {session.error}
        </p>
      )}
      {collecting && ended !== undefined ? (
        <CollectPanel
          finished={ended}
          onClose={() => {
            setCollecting(false);
          }}
          onFinish={() => {
            setCollecting(false);
            session.celebrate();
          }}
        />
      ) : null}
      <Dialog
        open={confirming}
        onOpenChange={setConfirming}
        title="The prescription isn't issued yet"
        description="It is still a draft, so the patient can't use it. Issue it as the visit ends, or leave it a draft."
        footer={
          <>
            <PillButton
              variant="ghost"
              onClick={() => {
                setConfirming(false);
              }}
            >
              Back to the prescription
            </PillButton>
            <PillButton
              variant="ghost"
              onClick={() => {
                run();
              }}
            >
              End without issuing
            </PillButton>
            <PillButton
              onClick={() => {
                run({ issueRx: true });
              }}
            >
              Issue and end
            </PillButton>
          </>
        }
      >
        <p className="text-sm">{`${String(medicines)} ${medicines === 1 ? "medicine" : "medicines"} in the draft.`}</p>
      </Dialog>
      <Dialog
        open={session.allergyAlerts !== undefined}
        onOpenChange={(open) => {
          if (!open) {
            session.clearAllergyAlerts();
            setReason("");
          }
        }}
        title="Allergy alert"
        description="This prescription may conflict with a recorded allergy. The visit is still open. Give a reason to issue it anyway."
        footer={
          <>
            <PillButton
              variant="ghost"
              onClick={() => {
                session.clearAllergyAlerts();
                setReason("");
              }}
            >
              Review the medicines
            </PillButton>
            <PillButton
              disabled={session.finishing || reason.trim() === ""}
              onClick={() => {
                run({ issueRx: true, overrideReason: reason.trim() });
              }}
            >
              {session.finishing ? "Ending…" : "Issue anyway and end"}
            </PillButton>
          </>
        }
      >
        <ul className="text-sm" style={{ margin: "0 0 12px", paddingLeft: 18 }}>
          {(session.allergyAlerts ?? []).map((alert, index) => (
            <li key={index}>{alert.message}</li>
          ))}
        </ul>
        <Field label="Reason to override" required>
          <TextArea
            rows={2}
            value={reason}
            onChange={(event) => {
              setReason(event.currentTarget.value);
            }}
          />
        </Field>
      </Dialog>
    </>
  );
}
