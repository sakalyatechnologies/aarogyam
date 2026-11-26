import { useEffect, useState } from "react";
import { Link } from "react-router";

import type { FamilyRelation, PhoneMatch } from "@aarogyam/api-client";
import { Button, Select } from "@sakalya/ui";

import { RELATION_OPTIONS } from "../../lib/family.js";
import { patientPath } from "../../lib/patients.js";
import { usePhoneLookup } from "../../walk-in-queries.js";

/** The number once the typing has paused, so the lookup runs on a finished number and not on every key. */
export function useSettled(value: string, ms = 400): string {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => {
      setSettled(value);
    }, ms);
    return () => {
      clearTimeout(timer);
    };
  }, [value, ms]);
  return settled;
}

/** Who the new patient is to the person already on this number. */
export interface FamilyPick {
  of: PhoneMatch;
  relation: FamilyRelation;
}

/**
 * Above the new-patient form: people already registered on the mobile number just typed, so a family isn't registered
 * twice. Open their profile, book them, or register a relative on the same number and link them. Dismissable.
 */
export function PhoneMatchCard({ mobile, family, onFamily }: { mobile: string; family: FamilyPick | undefined; onFamily: (pick: FamilyPick | undefined) => void }) {
  const settled = useSettled(mobile);
  const lookup = usePhoneLookup(settled);
  const [dismissed, setDismissed] = useState<string>();
  const items = lookup.data?.items ?? [];
  if (settled !== mobile || items.length === 0 || dismissed === settled) return null;
  return (
    <section aria-label="Already registered on this number" className="mb-4 flex max-w-2xl flex-col gap-3 rounded-2xl border border-border bg-surface-muted px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-sm font-semibold text-text">Already registered on this number</h2>
        <Button
          variant="ghost"
          onClick={() => {
            setDismissed(settled);
            onFamily(undefined);
          }}
        >
          Dismiss
        </Button>
      </div>
      <ul className="flex flex-col gap-3">
        {items.map((match) => (
          <li key={match.id} className="flex flex-col gap-2">
            <p className="text-sm text-text">
              <span className="font-semibold">{match.full_name}</span>
              {match.age_years == null ? "" : `, ${String(match.age_years)} yrs`}
              {", "}
              <span className="mk-mono">{match.number}</span>
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Link className="text-sm font-medium text-primary-text underline" to={patientPath(match)}>
                {`Open profile ${match.number}`}
              </Link>
              <Link className="text-sm font-medium text-primary-text underline" to={`/calendar?book=1&patient=${encodeURIComponent(match.id)}`}>
                {`Book ${match.number}`}
              </Link>
              <Button
                variant="secondary"
                aria-pressed={family?.of.id === match.id}
                onClick={() => {
                  onFamily(family?.of.id === match.id ? undefined : { of: match, relation: "child" });
                }}
              >
                Add family member on this number
              </Button>
            </div>
            {family?.of.id === match.id ? (
              <label className="flex flex-wrap items-center gap-2 text-sm text-text">
                {`The new patient is ${match.full_name}'s`}
                <Select
                  aria-label="Relation to the person on this number"
                  options={RELATION_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
                  value={family.relation}
                  onChange={(event) => {
                    const next = RELATION_OPTIONS.find((o) => o.value === event.currentTarget.value);
                    if (next !== undefined) onFamily({ of: match, relation: next.value });
                  }}
                />
              </label>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
