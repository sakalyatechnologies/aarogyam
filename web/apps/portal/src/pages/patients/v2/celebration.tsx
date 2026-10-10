import { CheckCircle2, Copy, MessageCircle, PartyPopper, Printer, QrCode as QrIcon, Smartphone } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useNavigate } from "react-router";

import { apiErrorOf, type Patient, type Prescription, type ShareInput } from "@aarogyam/api-client";
import { formatDateTime } from "@aarogyam/app-kit";
import { useToast } from "@sakalya/ui";

import { QrCode } from "../../../components/qr-code.js";
import { useClinic } from "../../../clinic.js";
import { displayName } from "../../../lib/patients.js";
import { useCreateShareLinkWith } from "../../prescriptions/queries.js";
import { dateAfter } from "./finish-visit.js";
import { PillButton } from "./kit.js";
import type { FinishedVisit } from "./visit-session.js";

const COLOURS = ["var(--brand)", "var(--amber)", "var(--indigo)", "var(--green)", "var(--red)"];

/** How long the patient's link works, in hours (the server accepts 24 to 720). */
export const LINK_EXPIRIES = [
  { label: "24 hours", hours: 24 },
  { label: "3 days", hours: 72 },
  { label: "7 days", hours: 168 },
  { label: "30 days", hours: 720 },
] as const;

type Channel = NonNullable<ShareInput["channel"]>;

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

/** What the server did about sending the link, in words for the doctor. */
function sentNote(channel: string, message: { status: string; reason?: string | null | undefined } | null | undefined): string | undefined {
  if (channel !== "whatsapp" && channel !== "sms") return undefined;
  const name = channel === "whatsapp" ? "WhatsApp" : "SMS";
  if (message === null || message === undefined) return undefined;
  if (message.status === "queued") return `${name} message queued for the patient. Tell them the PIN yourself.`;
  if (message.reason === "no_phone") return `No phone number on file, so no ${name} was sent. Share the link and PIN yourself.`;
  return `The ${name} message was not queued. Share the link and PIN yourself.`;
}

/** The prescription's link for the patient: pick how long it works, pick how to hand it over; our token and a PIN shown once. */
function RxLink({ rx }: { rx: Prescription }) {
  const navigate = useNavigate();
  const toast = useToast();
  const share = useCreateShareLinkWith(rx.id);
  const [hours, setHours] = useState<number>(168);
  const [showQr, setShowQr] = useState(false);
  const link = share.data === undefined ? undefined : `${window.location.origin}/shared/${share.data.token}`;
  const copy = (text: string) => {
    void navigator.clipboard.writeText(text).then(
      () => toast.show({ title: "Link copied", tone: "success" }),
      () => toast.show({ title: "Couldn't copy; select the link and copy it", tone: "warning" }),
    );
  };
  const make = (channel: Channel) => {
    share.mutate(
      { channel, expires_in_hours: hours },
      {
        onSuccess: (made) => {
          setShowQr(channel === "qr");
          if (channel === "link") copy(`${window.location.origin}/shared/${made.token}`);
        },
        onError: (thrown) => {
          toast.show({ title: apiErrorOf(thrown)?.message ?? "Couldn't make the link.", tone: "danger" });
        },
      },
    );
  };
  const expiry = LINK_EXPIRIES.find((e) => e.hours === hours)?.label ?? `${String(hours)} hours`;
  return (
    <div className="p360-cele-link">
      <p style={{ fontSize: 12, fontWeight: 600, color: "var(--ink)" }}>Prescription {rx.number ?? ""}</p>
      {link === undefined || share.data === undefined ? (
        <>
          <p className="mk-hint" style={{ margin: "4px 0 8px" }}>
            Make a link for the patient. It needs a PIN and works for {expiry}.
          </p>
          <div className="p360-chips" role="group" aria-label="Link works for">
            {LINK_EXPIRIES.map((option) => (
              <button
                key={option.hours}
                type="button"
                className="p360-chip"
                aria-pressed={hours === option.hours}
                disabled={share.isPending}
                onClick={() => {
                  setHours(option.hours);
                }}
              >
                {option.label}
              </button>
            ))}
          </div>
          <div className="p360-cele-actions" role="group" aria-label="Send the link">
            <PillButton variant="ghost" icon={<MessageCircle aria-hidden="true" />} disabled={share.isPending} onClick={() => { make("whatsapp"); }}>
              WhatsApp
            </PillButton>
            <PillButton variant="ghost" icon={<Smartphone aria-hidden="true" />} disabled={share.isPending} onClick={() => { make("sms"); }}>
              SMS
            </PillButton>
            <PillButton variant="ghost" icon={<Copy aria-hidden="true" />} disabled={share.isPending} onClick={() => { make("link"); }}>
              Copy
            </PillButton>
            <PillButton variant="ghost" icon={<QrIcon aria-hidden="true" />} disabled={share.isPending} onClick={() => { make("qr"); }}>
              QR
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
          {share.isPending ? <p role="status" className="mk-hint">Making the link…</p> : null}
        </>
      ) : (
        <>
          <p className="mono">{link}</p>
          <p style={{ marginTop: 6, fontSize: 12 }}>
            PIN <b style={{ fontFamily: "ui-monospace, monospace", letterSpacing: "0.2em", color: "var(--ink)" }}>{share.data.pin}</b> · shown only now · valid until {formatDateTime(share.data.expires_at)}
          </p>
          {sentNote(share.data.channel, share.data.message) === undefined ? null : (
            <p role="status" className="mk-hint" style={{ margin: "6px 0 0" }}>
              {sentNote(share.data.channel, share.data.message)}
            </p>
          )}
          <div className="p360-cele-actions">
            <PillButton
              variant="ghost"
              icon={<Copy aria-hidden="true" />}
              onClick={() => {
                copy(link);
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
            <PillButton
              variant="ghost"
              onClick={() => {
                share.reset();
                setShowQr(false);
              }}
            >
              New link
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
