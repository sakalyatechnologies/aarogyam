import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { apiErrorOf, unwrap, type ApplyPromoCode, type Invoice } from "@aarogyam/api-client";
import { formatRupees } from "@aarogyam/app-kit";
import { Button, Field, TextInput, useToast } from "@sakalya/ui";

import { useClinic } from "../../clinic.js";

/** What the desk reads when a code is refused (the server's `promo_*` reasons, billing offers spec 2.6). */
const REASONS: Readonly<Record<string, string>> = {
  promo_expired: "That code has expired.",
  promo_used: "That code has already been used.",
  promo_revoked: "That code was taken back.",
  promo_not_this_patient: "That code is for another patient.",
  promo_not_new_patient: "That code is for new patients only.",
  promo_needs_billing_write: "Only someone who can edit bills can use that code.",
  promo_no_eligible_line: "No line on this bill can take that code.",
  promo_not_for_this_visit: "This visit didn't record what the offer is for.",
  not_draft: "Only a draft bill can take a code.",
  bill_has_promo: "This bill already has a code.",
  hold_elsewhere: "That code is held on another bill.",
};

function reasonOf(thrown: unknown): string {
  const error = apiErrorOf(thrown);
  if (error === undefined) {
    return "Couldn't apply that code. Please try again.";
  }
  if (error.status === 404) {
    return "We don't know that code. Check it and try again.";
  }
  if (error.status === 429) {
    return "Too many tries. Wait a few minutes.";
  }
  return REASONS[error.code] ?? error.message;
}

/** `10%` or `₹500`. */
function amount(kind: string, value: number): string {
  return kind === "percent_bps" ? `${String(value / 100)}%` : formatRupees(value);
}

/**
 * A draft bill's offer: the patient's own live codes with Apply (or "Apply anyway" when the visit didn't record the
 * target), a box to enter a code, and Remove once one is on. Only for someone who can edit bills (`billing.write`).
 * Codes are never put in a URL, a toast or a log.
 */
export function DraftPromo({ invoice }: { invoice: Invoice }) {
  const { api, access, can } = useClinic();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [typed, setTyped] = useState("");
  const [problem, setProblem] = useState<string>();
  const allowed = can("billing.write") && invoice.status === "draft";
  const offersKey = ["patient-offers", access.org_id, invoice.patient.id, invoice.id];
  const offers = useQuery({
    queryKey: offersKey,
    queryFn: ({ signal }) => unwrap(api.getPatientOffers(invoice.patient.id, invoice.id, { signal })),
    enabled: allowed && invoice.promo == null,
  });
  const done = (next: Invoice) => {
    queryClient.setQueryData(["invoice", access.org_id, invoice.id], next);
    void queryClient.invalidateQueries({ queryKey: ["patient-offers", access.org_id] });
    setProblem(undefined);
  };
  const apply = useMutation({
    mutationFn: (input: ApplyPromoCode) => unwrap(api.applyInvoicePromo(invoice.id, input)),
    onSuccess: (next) => {
      done(next);
      setTyped("");
      toast.show({ title: "Offer applied", tone: "success" });
    },
    onError: (thrown) => {
      setProblem(reasonOf(thrown));
    },
  });
  const remove = useMutation({
    mutationFn: () => unwrap(api.removeInvoicePromo(invoice.id)),
    onSuccess: done,
    onError: (thrown) => {
      setProblem(reasonOf(thrown));
    },
  });
  if (!allowed) {
    return null;
  }
  const busy = apply.isPending || remove.isPending;
  return (
    <section aria-label="Offer" className="mt-4 flex max-w-md flex-col gap-2">
      <h3 className="text-sm font-semibold text-text">Offer</h3>
      {invoice.promo == null ? (
        <>
          {(offers.data?.codes ?? []).map((row) => (
            <div key={row.offer.id} className="flex items-center justify-between gap-2 text-sm">
              <span>
                {amount(row.offer.kind, row.offer.value)} off · till {row.offer.valid_to}
                {row.eligible ? "" : " · not recorded for this visit"}
              </span>
              <Button
                variant="secondary"
                disabled={busy}
                aria-label={`${row.eligible ? "Apply" : "Apply anyway"} ${amount(row.offer.kind, row.offer.value)} offer`}
                onClick={() => {
                  apply.mutate(row.eligible ? { code: row.offer.code } : { code: row.offer.code, override: true });
                }}
              >
                {row.eligible ? "Apply" : "Apply anyway"}
              </Button>
            </div>
          ))}
          <form
            className="flex items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (typed.trim() !== "") {
                apply.mutate({ code: typed.trim() });
              }
            }}
          >
            <Field label="Enter code">
              <TextInput
                value={typed}
                autoComplete="off"
                spellCheck={false}
                onChange={(event) => {
                  setTyped(event.target.value);
                }}
              />
            </Field>
            <Button type="submit" variant="secondary" disabled={busy || typed.trim() === ""}>
              Apply code
            </Button>
          </form>
        </>
      ) : (
        <div className="flex items-center justify-between gap-2 text-sm">
          <span>Offer applied: −{formatRupees(invoice.promo.discount_paise)}</span>
          <Button
            variant="secondary"
            disabled={busy}
            aria-label="Remove offer"
            onClick={() => {
              remove.mutate();
            }}
          >
            Remove
          </Button>
        </div>
      )}
      {problem === undefined ? null : (
        <p role="alert" className="text-sm text-danger-text">
          {problem}
        </p>
      )}
    </section>
  );
}
