/**
 * Patient 360's patient-app card: whether the patient sees this record in the Aarogyam patient
 * app, "Invite to patient app" (a one-time code shown as text and a QR code, and emailed), and
 * Confirm or Decline when the patient asked to connect. Links are never made from a phone or
 * name match: only a code the clinic issued, or a match staff confirm here.
 */
import { QrCode as QrIcon, Smartphone } from "lucide-react";
import { useState } from "react";

import { apiErrorOf, type PatientAppInvitation, type PatientId } from "@aarogyam/api-client";
import { formatDate } from "@aarogyam/app-kit";
import { Button, Dialog, useToast } from "@sakalya/ui";

import { MkCard, StatusChip } from "../../components/mk/index.js";
import { QrCode } from "../../components/qr-code.js";
import { useClinic } from "../../clinic.js";
import { useDecidePatientLink, useInvitePatientToApp, usePatientAppAccess } from "./queries.js";

export function PatientAppCard({ patientId }: { patientId: PatientId }) {
  const { can } = useClinic();
  const canWrite = can("patients.write");
  const access = usePatientAppAccess(patientId, can("patients.read"));
  const invite = useInvitePatientToApp(patientId);
  const decide = useDecidePatientLink(patientId);
  const toast = useToast();
  const [shown, setShown] = useState<PatientAppInvitation | undefined>(undefined);

  if (access.data === undefined) {
    return null;
  }
  const active = access.data.links.find((link) => link.status === "active");
  const pending = access.data.links.filter((link) => link.status === "pending");
  const onError = (thrown: unknown) => {
    toast.show({ title: apiErrorOf(thrown)?.message ?? "That didn't work. Please try again.", tone: "danger" });
  };
  const decideLink = (id: string, decision: "confirm" | "decline" | "revoke", done: string) => {
    decide.mutate({ id, decision }, { onSuccess: () => toast.show({ title: done, tone: "success" }), onError });
  };

  return (
    <MkCard title="Patient app">
      {active === undefined ? (
        <p className="mk-hint">
          <Smartphone aria-hidden="true" size={14} /> Not connected. Invite the patient to see their appointments, prescriptions and bills in the Aarogyam app.
        </p>
      ) : (
        <div className="mk-kv" style={{ alignItems: "center" }}>
          <span>
            <StatusChip tone="done">Connected</StatusChip> <span className="mk-hint">{active.account_email} · since {formatDate(active.linked_at ?? active.consented_at)}</span>
          </span>
          {canWrite ? (
            <button type="button" className="mk-link" disabled={decide.isPending} onClick={() => { decideLink(active.id, "revoke", "Disconnected from the app"); }}>
              Disconnect
            </button>
          ) : null}
        </div>
      )}
      {pending.map((link) => (
        <div key={link.id} className="mk-kv" style={{ alignItems: "center" }} role="group" aria-label="Request to connect">
          <span>
            <StatusChip tone="confirmed">Asked to connect</StatusChip> <span className="mk-hint">{link.account_email}</span>
          </span>
          {canWrite ? (
            <span className="flex gap-2">
              <Button variant="secondary" disabled={decide.isPending} onClick={() => { decideLink(link.id, "decline", "Request declined"); }}>
                Decline
              </Button>
              <Button disabled={decide.isPending} onClick={() => { decideLink(link.id, "confirm", "Connected to the app"); }}>
                Confirm
              </Button>
            </span>
          ) : null}
        </div>
      ))}
      {pending.length > 0 ? <p className="mk-hint">Confirm only if this is the same person: their email above was verified by the app.</p> : null}
      {access.data.code_expires_at == null ? null : (
        <p className="mk-hint">An invitation code is waiting until {formatDate(access.data.code_expires_at)}.</p>
      )}
      {canWrite && active === undefined ? (
        access.data.has_email ? (
          <div style={{ marginTop: 8 }}>
            <Button
              variant="secondary"
              icon={<QrIcon aria-hidden="true" className="size-4" />}
              disabled={invite.isPending}
              onClick={() => {
                invite.mutate(undefined, { onSuccess: setShown, onError });
              }}
            >
              {invite.isPending ? "Creating…" : "Invite to patient app"}
            </Button>
          </div>
        ) : (
          <p className="mk-hint">Add the patient's email to invite them: they sign in to the app with it.</p>
        )
      ) : null}
      {shown === undefined ? null : (
        <Dialog
          open
          onOpenChange={() => {
            setShown(undefined);
          }}
          title="Invite to patient app"
          description="The patient signs in to the Aarogyam app with the email on their record, chooses Add a clinic, and scans or types this code."
          footer={
            <Button
              onClick={() => {
                setShown(undefined);
              }}
            >
              Done
            </Button>
          }
        >
          <div className="flex flex-col items-center gap-3">
            <QrCode value={shown.code} size={180} label="Patient app link code" />
            <p className="mk-mono" style={{ fontSize: 24, letterSpacing: 2 }} aria-label="Link code">
              {shown.code}
            </p>
            <p className="mk-hint">
              {shown.emailed ? "We've emailed this code to the patient. " : ""}It works once and expires on {formatDate(shown.expires_at)}. It won't be shown again; invite again for a new one.
            </p>
          </div>
        </Dialog>
      )}
    </MkCard>
  );
}
