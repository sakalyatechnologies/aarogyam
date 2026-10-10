import { CheckCircle2, Copy, PartyPopper, Printer } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useNavigate } from "react-router";

import { apiErrorOf, type Patient, type Prescription } from "@aarogyam/api-client";
import { formatDateTime } from "@aarogyam/app-kit";
import { useToast } from "@sakalya/ui";

import { QrCode } from "../../../components/qr-code.js";
import { useClinic } from "../../../clinic.js";
import { displayName } from "../../../lib/patients.js";
import { useCreateShareLink } from "../../prescriptions/queries.js";
import { PillButton } from "./kit.js";
import type { FinishedVisit } from "./visit-session.js";

const COLOURS = ["var(--brand)", "var(--amber)", "var(--indigo)", "var(--green)", "var(--red)"];

/** The day `days` from now, as YYYY-MM-DD in the browser's calendar, for the booking screen. */
function dateAfter(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * Shown after a visit is finished: what the visit held, the prescription link (our token and PIN) and the next steps.
 * It appears only once the server has closed the visit, so it never says "saved" for something that was not.
 */
export function Celebration({ finished, patient, onClose }: { finished: FinishedVisit; patient: Patient; onClose: () => void }) {
  const { can } = useClinic();
  const navigate = useNavigate();
  const done = useRef<HTMLButtonElement>(null);
  const card = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    done.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      } else if (event.key === "Tab" && card.current !== null) {
        const items = [...card.current.querySelectorAll<HTMLElement>("a[href], button:not([disabled]), input, [tabindex]:not([tabindex='-1'])")];
        const first = items[0];
        const last = items[items.length - 1];
        if (first !== undefined && last !== undefined) {
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      before?.focus();
    };
  }, [onClose]);

  const medicines = finished.rx?.items.length ?? 0;
  const follow = finished.followUp !== null && finished.followUp.days !== null ? finished.followUp : null;
  return (
    <div className="p360-cele" role="presentation" onClick={onClose}>
      <div className="p360-confetti" aria-hidden="true">
        {Array.from({ length: 36 }, (_, i) => {
          const style: CSSProperties & Record<`--${string}`, string> = {
            background: COLOURS[i % COLOURS.length] ?? "var(--brand)",
            "--dx": `${String(Math.round(Math.cos(i * 0.7) * (180 + (i % 5) * 60)))}px`,
            "--dy": `${String(Math.round(Math.sin(i * 0.7) * 160 + 260))}px`,
            animationDelay: `${String((i % 6) * 40)}ms`,
          };
          return <span key={i} style={style} />;
        })}
      </div>
      <div
        ref={card}
        className="p360-cele-card"
        role="dialog"
        aria-modal="true"
        aria-label="Visit completed"
        onClick={(event) => {
          event.stopPropagation();
        }}
      >
        <span className="p360-cele-icon">
          <PartyPopper aria-hidden="true" />
        </span>
        <h2>Visit complete</h2>
        <p>
          {displayName(patient.full_name)} · {finished.procedures} {finished.procedures === 1 ? "procedure" : "procedures"} · {medicines} {medicines === 1 ? "medicine" : "medicines"}
          {follow === null ? "" : ` · follow-up in ${follow.label}`}
        </p>
        <span className="p360-cele-ok" role="status">
          <CheckCircle2 aria-hidden="true" /> Visit {finished.visit.number} closed{finished.noteSigned ? " and the note signed" : ""}
        </span>
        {finished.rx === undefined ? null : <RxLink rx={finished.rx} />}
        <div className="p360-cele-foot">
          {follow !== null && can("appointments.write") ? (
            <PillButton
              variant="ghost"
              onClick={() => {
                void navigate(`/calendar?book=1&patient=${encodeURIComponent(patient.id)}&from=${dateAfter(follow.days ?? 0)}`);
              }}
            >
              Book the follow-up
            </PillButton>
          ) : null}
          {can("billing.write") ? (
            <PillButton
              variant="ghost"
              onClick={() => {
                void navigate(`/billing/invoices/new?patient=${encodeURIComponent(patient.id)}`);
              }}
            >
              Create the bill
            </PillButton>
          ) : null}
          <PillButton ref={done} onClick={onClose}>
            Done
          </PillButton>
        </div>
      </div>
    </div>
  );
}

/** The prescription's link for the patient: our token and a PIN shown once, with copy and a QR code. */
function RxLink({ rx }: { rx: Prescription }) {
  const navigate = useNavigate();
  const toast = useToast();
  const share = useCreateShareLink(rx.id);
  const [showQr, setShowQr] = useState(false);
  const link = share.data === undefined ? undefined : `${window.location.origin}/shared/${share.data.token}`;
  return (
    <div className="p360-cele-link">
      <p style={{ fontSize: 12, fontWeight: 600, color: "var(--ink)" }}>Prescription {rx.number ?? ""}</p>
      {link === undefined || share.data === undefined ? (
        <>
          <p className="mk-hint" style={{ margin: "4px 0 0" }}>
            Make a link for the patient. It works for 7 days and needs a PIN.
          </p>
          <div className="p360-cele-actions">
            <PillButton
              variant="ghost"
              disabled={share.isPending}
              onClick={() => {
                share.mutate(undefined, {
                  onError: (thrown) => {
                    toast.show({ title: apiErrorOf(thrown)?.message ?? "Couldn't make the link.", tone: "danger" });
                  },
                });
              }}
            >
              {share.isPending ? "Making the link…" : "Create patient link"}
            </PillButton>
            <PillButton
              variant="ghost"
              icon={<Printer aria-hidden="true" />}
              onClick={() => {
                void navigate(`/prescriptions/${rx.id}/print`);
              }}
            >
              Print
            </PillButton>
          </div>
        </>
      ) : (
        <>
          <p className="mono">{link}</p>
          <p style={{ marginTop: 6, fontSize: 12 }}>
            PIN <b style={{ fontFamily: "ui-monospace, monospace", letterSpacing: "0.2em", color: "var(--ink)" }}>{share.data.pin}</b> · shown only now · valid until {formatDateTime(share.data.expires_at)}
          </p>
          <div className="p360-cele-actions">
            <PillButton
              variant="ghost"
              icon={<Copy aria-hidden="true" />}
              onClick={() => {
                void navigator.clipboard.writeText(link).then(
                  () => toast.show({ title: "Link copied", tone: "success" }),
                  () => toast.show({ title: "Couldn't copy; select the link and copy it", tone: "warning" }),
                );
              }}
            >
              Copy
            </PillButton>
            <PillButton
              variant="ghost"
              aria-pressed={showQr}
              onClick={() => {
                setShowQr(!showQr);
              }}
            >
              QR
            </PillButton>
          </div>
          {showQr ? (
            <div style={{ marginTop: 10, display: "grid", placeItems: "center" }}>
              <QrCode value={link} size={132} label="QR code for the prescription link" />
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
