import { Check, Cloud, CloudOff, Printer, Stethoscope } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";

import { Dialog } from "@sakalya/ui";

import { PillButton } from "./kit.js";

import { usePrescriptions } from "../../prescriptions/queries.js";
import "./p360.css";
import { useVisitSession, type FinishedVisit } from "./visit-session.js";

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

/**
 * One action bar for every layout: connection, what this visit holds so far, Print Rx and Finish visit. Finish goes through
 * `finishVisit` (see finish-visit.ts), so the single finish call can replace today's sign-and-close without touching this bar.
 */
export function ActionBar({ onFinished }: { onFinished: (finished: FinishedVisit) => void }) {
  const session = useVisitSession();
  const online = useOnline();
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);
  const prescriptions = usePrescriptions(session.canRx ? session.patientId : undefined);
  if (!session.canWrite) return null;

  const { visit, rx, note } = session;
  const latestIssued =
    rx.issued?.rx ?? [...(prescriptions.data?.items ?? [])].filter((r) => r.status === "issued").sort((a, b) => (b.issued_at ?? "").localeCompare(a.issued_at ?? ""))[0];
  const medicines = rx.draft?.items.length ?? 0;

  const run = () => {
    setConfirming(false);
    void session.finish().then((finished) => {
      if (finished !== undefined) onFinished(finished);
    });
  };

  return (
    <>
      <div className="p360-bar" role="region" aria-label="Visit actions">
        <span className={`p360-net ${online ? "" : "off"}`} role="status">
          {online ? <Cloud aria-hidden="true" /> : <CloudOff aria-hidden="true" />}
          {online ? "Online" : "No connection. Nothing is saved until it returns."}
        </span>
        {visit === undefined ? (
          <span className="p360-sum">No open visit</span>
        ) : (
          <span className="p360-sum">
            {session.procedures.length} done
            {` · ${String(medicines)} ${medicines === 1 ? "medicine" : "medicines"} in the draft`}
            {note.hasDraft && Object.values(note.values).some((v) => v.trim() !== "") ? " · note" : ""}
            {session.follow === null ? "" : ` · follow-up ${session.follow.label}`}
          </span>
        )}
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
          {visit === undefined ? (
            <PillButton icon={<Stethoscope aria-hidden="true" />} disabled={session.starting || session.visitLoading} onClick={session.startVisit}>
              {session.starting ? "Starting…" : "Start visit"}
            </PillButton>
          ) : (
            <PillButton
              icon={<Check aria-hidden="true" />}
              disabled={!online || session.finishing}
              onClick={() => {
                if (medicines > 0 && rx.draft !== undefined) {
                  setConfirming(true);
                } else {
                  run();
                }
              }}
            >
              {session.finishing ? "Finishing…" : "Finish visit"}
            </PillButton>
          )}
        </div>
      </div>
      {session.error === undefined || session.visit === undefined ? null : (
        <p role="alert" className="mk-hint" style={{ color: "var(--red)", margin: 0 }}>
          {session.error}
        </p>
      )}
      <Dialog
        open={confirming}
        onOpenChange={setConfirming}
        title="The prescription isn't issued yet"
        description="It is still a draft, so the patient can't use it. Finish anyway, or go back and issue it."
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
            <PillButton onClick={run}>Finish anyway</PillButton>
          </>
        }
      >
        <p className="text-sm">{`${String(medicines)} ${medicines === 1 ? "medicine" : "medicines"} in the draft.`}</p>
      </Dialog>
    </>
  );
}
