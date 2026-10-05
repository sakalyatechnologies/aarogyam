import { useState } from "react";

import { apiErrorOf, type PriceItem } from "@aarogyam/api-client";
import { ApiErrorNotice, formatRupees } from "@aarogyam/app-kit";
import { Skeleton } from "@sakalya/ui";

import { useClinicSettings } from "../../queries.js";
import { useAddPriceItem, usePriceItems } from "../billing/queries.js";
import { starterServices, type StarterService } from "./starter-services.js";
import { StepFrame, type StepProps } from "./step-frame.js";

interface Pick extends StarterService {
  on: boolean;
  /** The fee as typed, in rupees. */
  fee: string;
}

/** Step 4: the specialty's starter list, ticked and edited, added to the price list. */
export function ServicesStep({ props }: { props: StepProps }) {
  const settings = useClinicSettings();
  const items = usePriceItems();
  if (settings.isPending || items.isPending) {
    return <Skeleton shape="block" />;
  }
  if (settings.isError) {
    return <ApiErrorNotice title="Couldn't load your clinic's details" error={settings.error} onRetry={() => void settings.refetch()} />;
  }
  if (items.isError) {
    return <ApiErrorNotice title="Couldn't load the price list" error={items.error} onRetry={() => void items.refetch()} />;
  }
  return <ServicesForm props={props} specialty={settings.data.specialty} existing={items.data.items} />;
}

function ServicesForm({ props, specialty, existing }: { props: StepProps; specialty: string; existing: readonly PriceItem[] }) {
  const add = useAddPriceItem();
  const have = new Set(existing.map((item) => item.name.trim().toLowerCase()));
  const [picks, setPicks] = useState<Pick[]>(() =>
    starterServices(specialty)
      .filter((service) => !have.has(service.name.toLowerCase()))
      .map((service) => ({ ...service, on: true, fee: String(service.rupees) })),
  );
  const [error, setError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const edit = (name: string, changes: Partial<Pick>) => {
    setPicks((prev) => prev.map((pick) => (pick.name === name ? { ...pick, ...changes } : pick)));
  };

  const save = async () => {
    setError(undefined);
    const chosen = picks.filter((pick) => pick.on);
    for (const pick of chosen) {
      const rupees = Number(pick.fee);
      if (pick.name.trim() === "" || !Number.isFinite(rupees) || rupees < 0) {
        setError(`Check the fee for ${pick.name || "the entry without a name"}: it needs to be a number of rupees.`);
        return;
      }
    }
    setBusy(true);
    try {
      for (const pick of chosen) {
        await add.mutateAsync({ name: pick.name.trim(), category: pick.category, price_paise: Math.round(Number(pick.fee) * 100), taxable: false, gst_rate: 0 });
      }
      await props.done();
    } catch (thrown) {
      setError(apiErrorOf(thrown)?.message ?? "Couldn't add those to your price list. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <StepFrame
      title="Services and fees"
      hint="Untick what you don't offer and fix the fees. These become your price list for bills."
      props={props}
      onContinue={() => void save()}
      busy={busy}
      error={error}
      continueLabel={picks.some((pick) => pick.on) ? "Add to price list" : "Continue"}
    >
      {existing.length > 0 ? (
        <p className="mk-hint" style={{ marginTop: 0 }}>
          Already on your price list: {existing.length} {existing.length === 1 ? "entry" : "entries"}
          {existing.length <= 4 ? ` (${existing.map((item) => `${item.name} ${formatRupees(item.price_paise)}`).join(", ")})` : ""}.
        </p>
      ) : null}
      {picks.length === 0 ? (
        <p className="mk-hint">Everything on the starter list is already on your price list.</p>
      ) : (
        <ul className="sw-services">
          {picks.map((pick) => (
            <li key={pick.name} className="sw-service">
              <input
                type="checkbox"
                id={`sw-svc-${pick.name}`}
                checked={pick.on}
                aria-label={`Offer ${pick.name}`}
                onChange={(event) => {
                  edit(pick.name, { on: event.target.checked });
                }}
              />
              <label className="sw-sname" htmlFor={`sw-svc-${pick.name}`}>
                {pick.name}
                <small>{pick.category.replace("_", " ")}</small>
              </label>
              <div className="sw-rupee">
                <span aria-hidden="true">&#8377;</span>
                <input
                  className="mk-tin"
                  inputMode="numeric"
                  aria-label={`Fee for ${pick.name} in rupees`}
                  value={pick.fee}
                  disabled={!pick.on}
                  onChange={(event) => {
                    edit(pick.name, { fee: event.target.value });
                  }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </StepFrame>
  );
}
