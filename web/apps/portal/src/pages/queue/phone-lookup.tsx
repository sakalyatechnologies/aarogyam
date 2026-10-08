import { UserRoundPlus } from "lucide-react";

import type { PatientId } from "@aarogyam/api-client";
import { Avatar, Field, PhoneInput } from "@sakalya/ui";

import { ageSex } from "../../lib/patients.js";
import { usePhoneLookup } from "../../walk-in-queries.js";

/** Who the walk-in is: nobody chosen yet, a registered patient, or someone new. */
export type Who = { kind: "none" } | { kind: "existing"; id: PatientId; name: string; number: string } | { kind: "new" };

/** Mobile number first: as soon as it is complete, registered patients with it show to pick from. */
export function PhoneLookup({
  mobile,
  onMobile,
  who,
  onWho,
}: {
  mobile: string;
  onMobile: (digits: string) => void;
  who: Who;
  onWho: (who: Who) => void;
}) {
  const lookup = usePhoneLookup(mobile);
  const matches = lookup.data?.items ?? [];
  const complete = /^[6-9]\d{9}$/.test(mobile);
  return (
    <div className="wi-section">
      <Field label="Mobile number" hint="Families often share a number: pick the right person.">
        <PhoneInput
          autoComplete="off"
          value={mobile}
          onValueChange={(digits) => {
            onMobile(digits);
            if (who.kind === "existing") onWho({ kind: "none" });
          }}
        />
      </Field>
      {!complete ? null : lookup.isFetching ? (
        <p className="qp-hint">Looking up…</p>
      ) : (
        <div className="flex flex-col gap-2" role="group" aria-label="Patients with this number">
          {matches.length === 0 ? <p className="qp-hint">Nobody is registered with this number yet.</p> : null}
          {matches.map((m) => (
            <button
              key={m.id}
              type="button"
              className="wi-match"
              aria-pressed={who.kind === "existing" && who.id === m.id}
              onClick={() => {
                onWho({ kind: "existing", id: m.id, name: m.full_name, number: m.number });
              }}
            >
              <Avatar name={m.full_name} size="sm" />
              <span className="wi-match-t">
                <b>{m.full_name}</b>
                <span>
                  {m.number} · {ageSex(m.age_years ?? null, m.sex)}
                </span>
              </span>
              <span className="text-xs font-semibold text-primary-text">This is them</span>
            </button>
          ))}
          <button
            type="button"
            className="wi-match"
            aria-pressed={who.kind === "new"}
            onClick={() => {
              onWho({ kind: "new" });
            }}
          >
            <UserRoundPlus aria-hidden="true" className="size-5" />
            <span className="wi-match-t">
              <b>Someone new</b>
              <span>Register them now</span>
            </span>
          </button>
        </div>
      )}
    </div>
  );
}
