import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { QrCode } from "lucide-react";
import { useState } from "react";

import { apiErrorOf, unwrap, type Arrival } from "@aarogyam/api-client";
import { formatRelative } from "@aarogyam/app-kit";
import { Button, Drawer, useToast } from "@sakalya/ui";

import { useClinic } from "../../clinic.js";
import { IntakeSummary } from "../../components/intake/intake-summary.js";
import { QUEUE_POLL_MS } from "../../queries.js";

/** Requests patients sent by scanning the clinic's QR code, oldest first. Refreshed with the queue. */
export function useArrivals(enabled: boolean) {
  const { api, access } = useClinic();
  return useQuery({
    queryKey: ["arrivals", access.org_id],
    queryFn: ({ signal }) => unwrap(api.listArrivals({ signal })),
    enabled,
    staleTime: 10_000,
    refetchInterval: QUEUE_POLL_MS,
  });
}

function useDecide() {
  const { api, access } = useClinic();
  const queryClient = useQueryClient();
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["arrivals", access.org_id] });
    void queryClient.invalidateQueries({ queryKey: ["queue", access.org_id] });
    void queryClient.invalidateQueries({ queryKey: ["today", access.org_id] });
    void queryClient.invalidateQueries({ queryKey: ["patients", access.org_id] });
  };
  const accept = useMutation({
    mutationFn: ({ id, patientId }: { id: string; patientId: string | null }) => unwrap(api.acceptArrival(id, patientId === null ? {} : { patient_id: patientId })),
    onSettled: refresh,
  });
  const dismiss = useMutation({
    mutationFn: (id: string) => unwrap(api.dismissArrival(id)),
    onSettled: refresh,
  });
  return { accept, dismiss };
}

/** "2 waiting to check in": a strip above the queue that opens the list. Nothing shows when nobody has scanned. */
export function ArrivalsStrip() {
  const { can } = useClinic();
  const allowed = can("patients.read");
  const arrivals = useArrivals(allowed);
  const [open, setOpen] = useState(false);
  const count = arrivals.data?.items.length ?? 0;
  if (!allowed || (count === 0 && !open)) return null;
  return (
    <>
      <div className="mb-3 flex items-center justify-between gap-3 rounded-2xl border border-border bg-surface px-4 py-3" role="status">
        <p className="flex items-center gap-2 text-sm font-semibold text-text">
          <QrCode aria-hidden="true" className="size-5 text-primary" />
          {`${String(count)} waiting to check in`}
        </p>
        <Button
          variant="secondary"
          onClick={() => {
            setOpen(true);
          }}
        >
          Review
        </Button>
      </div>
      <Drawer open={open} onOpenChange={setOpen} title="Waiting to check in" description="Patients who scanned the clinic's QR code. Nobody is in the queue until you accept." size="lg">
        {count === 0 ? <p className="text-sm text-muted">Nobody is waiting to be checked in.</p> : null}
        <ul className="flex flex-col gap-4">
          {(arrivals.data?.items ?? []).map((arrival) => (
            <ArrivalCard key={arrival.id} arrival={arrival} />
          ))}
        </ul>
      </Drawer>
    </>
  );
}

const NEW_PATIENT = "new";

function ArrivalCard({ arrival }: { arrival: Arrival }) {
  const { can } = useClinic();
  const toast = useToast();
  const { accept, dismiss } = useDecide();
  const [pick, setPick] = useState(NEW_PATIENT);
  const canAccept = can("patients.write") && can("appointments.write") && can("intake.write");
  const submitted = [arrival.first_name, arrival.last_name ?? ""].join(" ").trim();
  const busy = accept.isPending || dismiss.isPending;

  const failed = (thrown: unknown) => {
    const error = apiErrorOf(thrown);
    toast.show({
      title: error?.status === 409 || error?.status === 404 ? "Someone at the desk already handled this one." : (error?.message ?? "Couldn't do that. Please try again."),
      tone: "danger",
    });
  };

  return (
    <li className="flex flex-col gap-2 rounded-2xl border border-border bg-surface p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-base font-bold text-text">{submitted}</p>
        <p className="text-xs text-muted">{formatRelative(arrival.created_at, new Date())}</p>
      </div>
      <p className="text-sm text-muted">
        {arrival.phone}
        {arrival.age_years == null ? "" : ` · ${String(arrival.age_years)} yrs`}
      </p>
      {arrival.for_self ? null : (
        <p className="text-sm text-text">{`Filled in by ${arrival.contact_name ?? "someone"}${arrival.relation == null || arrival.relation === "" ? "" : ` (${arrival.relation})`}`}</p>
      )}
      <p className="text-sm text-text">{[...arrival.reason_labels, ...(arrival.reason_text == null || arrival.reason_text === "" ? [] : [arrival.reason_text])].join(" · ")}</p>
      {arrival.health_labels.length === 0 && (arrival.allergies_text ?? "") === "" ? null : (
        <p className="text-sm font-medium text-warning-text">{[...arrival.health_labels, ...((arrival.allergies_text ?? "") === "" ? [] : [`Allergies: ${arrival.allergies_text ?? ""}`])].join(" · ")}</p>
      )}
      <IntakeSummary intake={arrival.intake} />
      {arrival.matches.items.length === 0 ? null : (
        <fieldset className="flex flex-col gap-1.5 border-0 p-0">
          <legend className="mb-1 text-sm font-semibold text-text">Same phone as</legend>
          <label className="flex min-h-10 items-center gap-2 text-sm text-text">
            <input type="radio" name={`who-${arrival.id}`} checked={pick === NEW_PATIENT} onChange={() => { setPick(NEW_PATIENT); }} />
            {`New patient: ${submitted}`}
          </label>
          {arrival.matches.items.map((match) => (
            <label key={match.id} className="flex min-h-10 items-center gap-2 text-sm text-text">
              <input type="radio" name={`who-${arrival.id}`} checked={pick === match.id} onChange={() => { setPick(match.id); }} />
              {`${match.full_name} (${match.number}) · submitted as ${submitted}`}
            </label>
          ))}
        </fieldset>
      )}
      <div className="mt-1 flex flex-wrap gap-2">
        {canAccept ? (
          <Button
            disabled={busy}
            onClick={() => {
              accept.mutate(
                { id: arrival.id, patientId: pick === NEW_PATIENT ? null : pick },
                {
                  onSuccess: (done) => {
                    toast.show({ title: done.token == null ? "Registered" : `Added to the queue: token ${String(done.token.token_number)}`, tone: "success" });
                  },
                  onError: failed,
                },
              );
            }}
          >
            Accept
          </Button>
        ) : null}
        {can("patients.write") ? (
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => {
              dismiss.mutate(arrival.id, { onError: failed });
            }}
          >
            Dismiss
          </Button>
        ) : null}
      </div>
    </li>
  );
}
