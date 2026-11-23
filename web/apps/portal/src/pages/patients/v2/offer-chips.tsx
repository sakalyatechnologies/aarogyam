import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";

import { apiErrorOf, unwrap, type IssuedCode, type OfferPresets, type VisitId } from "@aarogyam/api-client";

import { useClinic } from "../../../clinic.js";
import { PillButton } from "./kit.js";

const VALID_DAYS = [7, 30, 60, 90] as const;

/** `10%` for basis points, `₹500` for paise. */
export function offerAmount(kind: string, value: number): string {
  return kind === "percent_bps" ? `${String(value / 100)}%` : `₹${(value / 100).toLocaleString("en-IN")}`;
}

const REFUSALS: Readonly<Record<string, string>> = {
  visit_open: "Finish the visit first.",
  forbidden: "You can't give offers here.",
};

/** A short date such as `19 Dec`. */
function shortDate(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  return date.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
}

/**
 * The offer and referral chips above "Send on WhatsApp" (offers spec 2.2). One tap gives the code with the clinic's
 * presets; the chip then shows the code with an Undo. "Edit" changes the terms within the caller's caps. The chips
 * are hidden without `offers.give` or when the clinic switched that kind off. The message itself reads the codes on
 * the server, so Send needs nothing from here. Codes stay on screen only; they are never put in a URL or a log.
 */
export function OfferChips({ visitId }: { visitId: VisitId }) {
  const { api, access, can } = useClinic();
  const allowed = can("offers.give") && can("clinical.read");
  const queryClient = useQueryClient();
  const key = ["visit-offers", access.org_id, visitId];
  const offers = useQuery({ queryKey: key, queryFn: ({ signal }) => unwrap(api.getVisitOffers(visitId, { signal })), enabled: allowed, staleTime: 30_000 });
  const issue = useMutation({
    mutationFn: (input: Parameters<typeof api.issueVisitOffers>[1]) => unwrap(api.issueVisitOffers(visitId, input)),
    onSuccess: (made) => {
      queryClient.setQueryData(key, made);
    },
  });
  const undo = useMutation({
    mutationFn: (id: string) => unwrap(api.revokePromoCode(id, { reason: "undo" })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key }),
  });
  const [editing, setEditing] = useState(false);

  const data = offers.data;
  if (!allowed || data === undefined) {
    return null;
  }
  const presets = data.presets;
  const showOffer = presets.offer_enabled || data.patient_offer != null;
  const showReferral = presets.referral_enabled || data.referral != null;
  if (!showOffer && !showReferral) {
    return null;
  }
  const failure = issue.error ?? undo.error;
  const problem = failure === null ? undefined : apiErrorOf(failure);
  const message = problem === undefined ? undefined : (REFUSALS[problem.code] ?? problem.message);
  const busy = issue.isPending || undo.isPending;

  return (
    <div style={{ margin: "0 0 10px" }}>
      <div className="p360-chips" role="group" aria-label="Offers for the patient">
        {showOffer ? (
          data.patient_offer == null ? (
            <>
              <button type="button" className="p360-chip" disabled={busy} onClick={() => { issue.mutate({ patient_offer: {} }); }}>
                🎁 Offer {offerAmount(presets.offer_kind, presets.offer_value)} · {presets.offer_valid_days} days
              </button>
              <button
                type="button"
                className="p360-chip"
                aria-expanded={editing}
                onClick={() => {
                  setEditing(!editing);
                }}
              >
                Edit
              </button>
            </>
          ) : (
            <IssuedChip code={data.patient_offer} busy={busy} onUndo={() => { undo.mutate(data.patient_offer?.id ?? ""); }} />
          )
        ) : null}
        {showReferral ? (
          data.referral == null ? (
            <button type="button" className="p360-chip" disabled={busy} onClick={() => { issue.mutate({ referral: true }); }}>
              🤝 Referral code
            </button>
          ) : (
            <IssuedChip code={data.referral} busy={busy} onUndo={() => { undo.mutate(data.referral?.id ?? ""); }} />
          )
        ) : null}
      </div>
      {editing && data.patient_offer == null ? (
        <EditOffer
          presets={presets}
          busy={busy}
          onGive={(terms) => {
            issue.mutate({ patient_offer: terms }, { onSuccess: () => { setEditing(false); } });
          }}
        />
      ) : null}
      {message === undefined ? null : (
        <p role="alert" className="mk-hint" style={{ marginTop: 6, color: "var(--red)" }}>
          {message}
        </p>
      )}
    </div>
  );
}

function IssuedChip({ code, busy, onUndo }: { code: IssuedCode; busy: boolean; onUndo: () => void }) {
  const what = code.purpose === "referral" ? "Referral" : "Offer";
  return (
    <span className="p360-chip" role="status" style={{ display: "inline-flex", gap: 8, alignItems: "center", cursor: "default" }}>
      <span>
        ✓ {code.code}
        <span className="mk-hint"> · {what} {offerAmount(code.kind, code.value)} till {shortDate(code.valid_to)}</span>
      </span>
      <button type="button" className="p360-chip" disabled={busy} onClick={onUndo} aria-label={`Undo ${what.toLowerCase()} ${code.code}`}>
        Undo
      </button>
    </span>
  );
}

/** The Edit sheet: percent or rupees, the value, and how long it lasts. No free text. */
function EditOffer({ presets, busy, onGive }: { presets: OfferPresets; busy: boolean; onGive: (terms: { kind: string; value: number; valid_days: number }) => void }) {
  const id = useId();
  const [kind, setKind] = useState(presets.offer_kind);
  const [amount, setAmount] = useState(String(presets.offer_value / 100));
  const [days, setDays] = useState(presets.offer_valid_days);
  const percent = kind === "percent_bps";
  const cap = percent ? presets.max_percent_bps : presets.max_fixed_paise;
  const value = Math.round(Number(amount) * 100);
  const valid = Number.isFinite(value) && value >= (percent ? 1 : 100) && value <= cap;
  const allowedDays = VALID_DAYS.filter((d) => d <= presets.max_valid_days);
  return (
    <div role="group" aria-label="Edit the offer" style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "end", marginTop: 8 }}>
      <label htmlFor={`${id}-kind`} className="mk-hint">
        Type
        <select
          id={`${id}-kind`}
          value={kind}
          onChange={(event) => {
            setKind(event.target.value);
            setAmount(event.target.value === "percent_bps" ? "10" : "500");
          }}
        >
          <option value="percent_bps">Percent off</option>
          <option value="fixed">Rupees off</option>
        </select>
      </label>
      <label htmlFor={`${id}-value`} className="mk-hint">
        {percent ? "Percent" : "Rupees"}
        <input
          id={`${id}-value`}
          type="number"
          min={percent ? 1 : 1}
          max={cap / 100}
          step="1"
          value={amount}
          onChange={(event) => {
            setAmount(event.target.value);
          }}
          aria-invalid={!valid}
        />
      </label>
      <label htmlFor={`${id}-days`} className="mk-hint">
        Valid for
        <select
          id={`${id}-days`}
          value={days}
          onChange={(event) => {
            setDays(Number(event.target.value));
          }}
        >
          {allowedDays.map((d) => (
            <option key={d} value={d}>
              {d} days
            </option>
          ))}
        </select>
      </label>
      <PillButton variant="primary" disabled={!valid || busy} onClick={() => { onGive({ kind, value, valid_days: days }); }}>
        Give offer
      </PillButton>
      {valid ? null : (
        <span role="alert" className="mk-hint" style={{ color: "var(--red)" }}>
          Up to {offerAmount(kind, cap)} for your role.
        </span>
      )}
    </div>
  );
}
