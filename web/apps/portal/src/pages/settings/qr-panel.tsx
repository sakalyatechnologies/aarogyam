import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Printer, RefreshCw } from "lucide-react";
import { useState } from "react";

import { apiErrorOf, unwrap } from "@aarogyam/api-client";
import { ApiErrorNotice } from "@aarogyam/app-kit";
import { Button, Dialog, QrCode, useToast } from "@sakalya/ui";

import { useClinic } from "../../clinic.js";
import { MkCard, Toggle } from "../../components/mk/index.js";
import { SkeletonRows } from "../../components/skeleton-rows.js";
import "./qr-panel.css";

function useSelfCheckIn() {
  const { api, access } = useClinic();
  const queryClient = useQueryClient();
  const key = ["self-check-in", access.org_id];
  const settings = useQuery({ queryKey: key, queryFn: ({ signal }) => unwrap(api.getSelfCheckInSettings({ signal })), staleTime: 60_000 });
  const store = (next: unknown) => {
    queryClient.setQueryData(key, next);
  };
  const setEnabled = useMutation({ mutationFn: (enabled: boolean) => unwrap(api.setSelfCheckIn(enabled)), onSuccess: store });
  const rotate = useMutation({ mutationFn: () => unwrap(api.newSelfCheckInKey()), onSuccess: store });
  return { settings, setEnabled, rotate };
}

/** Settings, "Patient QR": the switch, the code to print, and a way to retire old posters. Owner only. */
export function QrPanel() {
  const { session } = useClinic();
  const { settings, setEnabled, rotate } = useSelfCheckIn();
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const data = settings.data;
  const url = data?.enabled === true ? (data.url ?? null) : null;
  const fail = (thrown: unknown) => {
    toast.show({ title: apiErrorOf(thrown)?.message ?? "Couldn't save that. Please try again.", tone: "danger" });
  };
  const origin = url === null ? "" : new URL(url).origin;
  const host = url === null ? "" : new URL(url).host;
  const copy = (text: string, what: string) => {
    void navigator.clipboard.writeText(text).then(
      () => { toast.show({ title: `${what} copied`, tone: "success" }); },
      () => { toast.show({ title: "Couldn't copy. Select the link and copy it by hand.", tone: "danger" }); },
    );
  };

  return (
    <>
      <MkCard title="Patient QR" hint="Patients scan it at the clinic, fill in a short form and wait for the desk to call them in">
        {data === undefined ? (
          settings.isError ? (
            <ApiErrorNotice title="Couldn't load the patient QR" error={settings.error} onRetry={() => void settings.refetch()} />
          ) : (
            <SkeletonRows count={3} label="Loading the patient QR" />
          )
        ) : (
          <>
            <div className="mk-setrow">
              <div>
                <b>Patient check-in by QR</b>
                <p>{data.enabled ? "Scanning the code sends a request to the front desk" : "Off: scanning does nothing"}</p>
              </div>
              <Toggle
                checked={data.enabled}
                disabled={setEnabled.isPending}
                label="Patient check-in by QR"
                onChange={(next) => {
                  setEnabled.mutate(next, { onError: fail });
                }}
              />
            </div>
            {url === null ? null : (
              <div className="qrp">
                <QrCode value={url} size={240} label="QR code for patient check-in" errorCorrection="M" className="qrp-code" />
                <div className="qrp-side">
                  <p className="mk-hint" style={{ margin: 0 }}>
                    Print it and put it at the front desk or on the door. Anyone with this code can send the desk a request, so keep it inside the clinic.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button icon={<Printer aria-hidden="true" className="size-4" />} onClick={() => { window.print(); }}>
                      Print poster
                    </Button>
                    <Button variant="secondary" icon={<RefreshCw aria-hidden="true" className="size-4" />} onClick={() => { setConfirming(true); }}>
                      New QR
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </MkCard>
      {url === null ? null : (
        <MkCard title="Booking link" hint="For your own website or WhatsApp: patients book from anywhere">
          <div className="mk-setrow">
            <div>
              <b>{`${host}/book`}</b>
              <p>Remote booking, not for the poster</p>
            </div>
            <Button variant="secondary" icon={<Copy aria-hidden="true" className="size-4" />} onClick={() => { copy(`${origin}/book`, "Booking link"); }}>
              Copy
            </Button>
          </div>
        </MkCard>
      )}
      <Dialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Make a new QR code?"
        description="Posters you already printed stop working as soon as you do this. Print the new one and replace them."
        size="sm"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setConfirming(false);
              }}
            >
              Keep the current QR
            </Button>
            <Button
              disabled={rotate.isPending}
              onClick={() => {
                rotate.mutate(undefined, {
                  onSuccess: () => {
                    setConfirming(false);
                    toast.show({ title: "New QR made. Old posters no longer work.", tone: "success" });
                  },
                  onError: fail,
                });
              }}
            >
              Make a new QR
            </Button>
          </>
        }
      />
      {url === null ? null : (
        <div className="qr-poster" aria-hidden="true">
          <h1>{session.clinic.name}</h1>
          <p className="qr-poster-lead">Scan to check in</p>
          <QrCode value={url} size={420} label="QR code for patient check-in" errorCorrection="M" />
          <p className="qr-poster-host">{host}</p>
        </div>
      )}
    </>
  );
}
