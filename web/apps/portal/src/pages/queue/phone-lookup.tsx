import { UserRoundPlus, UsersRound } from "lucide-react";

import type { FamilyRelation, PatientId } from "@aarogyam/api-client";
import { Avatar, Field, PhoneInput } from "@sakalya/ui";

import { RELATION_OPTIONS } from "../../lib/family.js";
import { ageSex } from "../../lib/patients.js";
import { usePhoneLookup } from "../../walk-in-queries.js";

/** Who the walk-in is: nobody chosen yet, a registered patient, someone new, or someone new who is family of a registered patient. */
export type Who =
  | { kind: "none" }
  | { kind: "existing"; id: PatientId; name: string; number: string }
  | { kind: "new" }
  | { kind: "family"; id: PatientId; name: string; number: string; relation: FamilyRelation };

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
            if (who.kind === "existing" || who.kind === "family") onWho({ kind: "none" });
          }}
        />
      </Field>
      {!complete ? null : lookup.isFetching ? (
        <p className="qp-hint">Looking up…</p>
      ) : (
        <div className="flex flex-col gap-2" role="group" aria-label="Patients with this number">
          {matches.length === 0 ? <p className="qp-hint">Nobody is registered with this number yet.</p> : null}
          {matches.map((m) => (
            <div key={m.id} className="flex flex-col gap-1">
              <button
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
              <button
                type="button"
                className="wi-match"
                aria-pressed={who.kind === "family" && who.id === m.id}
                onClick={() => {
                  onWho({ kind: "family", id: m.id, name: m.full_name, number: m.number, relation: who.kind === "family" ? who.relation : "child" });
                }}
              >
                <UsersRound aria-hidden="true" className="size-5" />
                <span className="wi-match-t">
                  <b>Family member of {m.full_name}</b>
                  <span>Register them as new, linked as family</span>
                </span>
              </button>
            </div>
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
      {who.kind === "family" ? (
        <div>
          <p className="qp-label">{`They are ${who.name}'s…`}</p>
          <div className="qp-chips" role="group" aria-label="Relation">
            {RELATION_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className="qp-chip"
                aria-pressed={who.relation === option.value}
                onClick={() => {
                  onWho({ ...who, relation: option.value });
                }}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
