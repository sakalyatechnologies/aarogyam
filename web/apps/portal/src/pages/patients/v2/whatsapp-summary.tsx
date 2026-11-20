import { useMutation } from "@tanstack/react-query";
import { MessageCircle } from "lucide-react";
import { useState } from "react";

import { apiErrorOf, unwrap, type VisitId, type VisitPatientMessage } from "@aarogyam/api-client";

import { useClinic } from "../../../clinic.js";
import { PillButton } from "./kit.js";

/**
 * How the summary leaves the browser. `whatsapp://` opens WhatsApp Desktop on this computer with the full text, a
 * local hand-off with nothing in a web URL; tests replace `open`.
 */
export const handoff = {
  open: (url: string) => {
    window.location.href = url;
  },
};

const digits = (phone: string) => phone.replace(/\D/g, "");

/** The WhatsApp Desktop link with the full text (local protocol, never a web URL). */
export const desktopLink = (message: VisitPatientMessage) =>
  `whatsapp://send?phone=${digits(message.phone_e164)}&text=${encodeURIComponent(message.text)}`;

/** The WhatsApp Web link: only the short text (no clinical words), because it travels in a web URL. */
export const webLink = (message: VisitPatientMessage) =>
  `https://wa.me/${digits(message.phone_e164)}?text=${encodeURIComponent(message.short_text)}`;

const REFUSALS: Readonly<Record<string, string>> = {
  visit_open: "Finish the visit first, then send the summary.",
  no_phone: "This patient has no mobile number. Add one to send the summary.",
  no_consent: "The patient hasn't agreed to messages about their care.",
  opted_out: "The patient has turned off WhatsApp messages from the clinic.",
};

const timeOf = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });

/**
 * "Send on WhatsApp" on the Done screen: the server builds the patient's summary (why they came, what was done, the
 * plan, care at home, medicines, the link and its PIN) and the doctor sends it from their own WhatsApp. The message
 * stays in this component's memory only. The screen says "prepared", never "sent": we can't see WhatsApp.
 *
 * `compact` is the queue card's version: one "Prepare WhatsApp summary" button, no heading or explainer.
 */
export function WhatsAppSummary({ visitId, compact = false }: { visitId: VisitId; compact?: boolean }) {
  const { api, can } = useClinic();
  const prepare = useMutation({ mutationFn: () => unwrap(api.prepareVisitPatientMessage(visitId)) });
  const [message, setMessage] = useState<VisitPatientMessage>();
  const [preparedAt, setPreparedAt] = useState<string>();

  if (!can("clinical.read") || !can("patients.contact")) {
    return null;
  }

  const send = () => {
    prepare.mutate(undefined, {
      onSuccess: (made) => {
        setMessage(made);
        setPreparedAt(new Date().toISOString());
        handoff.open(desktopLink(made));
      },
    });
  };
  const error = prepare.error === null ? undefined : apiErrorOf(prepare.error);
  const refusal = error === undefined ? undefined : (REFUSALS[error.code] ?? error.message);

  return (
    <div className={compact ? undefined : "p360-cele-link"}>
      {compact ? null : <p style={{ fontSize: 12, fontWeight: 600, color: "var(--ink)" }}>Visit summary for the patient</p>}
      {message === undefined || preparedAt === undefined ? (
        <>
          {compact ? null : (
            <p className="mk-hint" style={{ margin: "4px 0 8px" }}>
              Why they came, what you did, their plan, care at home and medicines, with a link that needs a PIN.
            </p>
          )}
          <PillButton variant={compact ? "ghost" : "primary"} icon={<MessageCircle aria-hidden="true" />} onClick={send} disabled={prepare.isPending}>
            {prepare.isPending ? "Preparing…" : compact ? "Prepare WhatsApp summary" : "Send on WhatsApp"}
          </PillButton>
          {refusal === undefined ? null : (
            <p role="alert" className="mk-hint" style={{ marginTop: 8, color: "var(--red)" }}>
              {refusal}
            </p>
          )}
        </>
      ) : (
        <>
          <p role="status" className="mk-hint" style={{ margin: "4px 0 8px" }}>
            Summary prepared {timeOf(preparedAt)}
            {message.recipient === "guardian" ? " for the parent or guardian" : ""}. Press Send in WhatsApp.
            {message.auto_sent_at == null ? "" : ` An automatic summary also went at ${timeOf(message.auto_sent_at)}.`}
          </p>
          <div className="p360-chips">
            <PillButton
              variant="ghost"
              onClick={() => {
                handoff.open(desktopLink(message));
              }}
            >
              Open WhatsApp again
            </PillButton>
            <a className="p360-chip" href={webLink(message)} target="_blank" rel="noreferrer">
              Use WhatsApp Web
            </a>
          </div>
        </>
      )}
    </div>
  );
}
