import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiErrorOf, unwrap, type PresentSettings } from "@aarogyam/api-client";
import { ApiErrorNotice } from "@aarogyam/app-kit";
import { Select, Skeleton, Switch, useToast } from "@sakalya/ui";

import { MkCard } from "../../components/mk/index.js";
import { useClinic } from "../../clinic.js";
import { REFERENCE } from "../../lib/cache-policy.js";
import { usePriceItems } from "../billing/queries.js";

/** The parts the usual options price, by seeded procedure id (specialties/dental/present/options.json). */
const PARTS: readonly { key: string; label: string }[] = [
  { key: "root_canal", label: "Root canal treatment" },
  { key: "crown", label: "Crown" },
  { key: "extraction", label: "Extraction" },
  { key: "implant", label: "Implant" },
  { key: "bridge", label: "Bridge" },
];

const NONE = "none";

function usePresentSettings() {
  const { api, access } = useClinic();
  return useQuery({ queryKey: ["present-settings", access.org_id] as const, queryFn: ({ signal }) => unwrap(api.getPresentSettings({ signal })), ...REFERENCE });
}

function useUpdatePresentSettings() {
  const { api, access } = useClinic();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (next: PresentSettings) => unwrap(api.updatePresentSettings(next)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["present-settings", access.org_id] }),
  });
}

/**
 * Settings -> Show patient. Prices appear in Show patient only behind the doctor's Prices tap, only for members who may read
 * billing, and only for options whose every part is mapped to a price-list item here. Nothing is matched by name.
 */
export function PresentPanel() {
  const settings = usePresentSettings();
  const items = usePriceItems();
  const update = useUpdatePresentSettings();
  const toast = useToast();
  if (settings.isPending || items.isPending) return <Skeleton shape="block" />;
  if (settings.isError) return <ApiErrorNotice title="Couldn't load the Show patient settings" error={settings.error} onRetry={() => void settings.refetch()} />;
  if (items.isError) return <ApiErrorNotice title="Couldn't load the price list" error={items.error} onRetry={() => void items.refetch()} />;
  const current = settings.data;
  const save = (next: PresentSettings) => {
    update.mutate(next, {
      onError: (thrown) => {
        toast.show({ title: apiErrorOf(thrown)?.message ?? "Couldn't save that.", tone: "danger" });
      },
    });
  };
  const coded = items.data.items.filter((i) => i.active && i.code != null);
  const options = [{ value: NONE, label: "Not priced" }, ...coded.map((i) => ({ value: i.code ?? "", label: i.name }))];
  return (
    <MkCard title="Show patient" hint="What the patient panel may show about cost">
      <Switch
        label="Show prices"
        hint="Doctors who can read billing get a Prices button on the options. The patient sees a price only for an option whose parts are all mapped below; otherwise they are told to ask the front desk."
        checked={current.show_prices}
        disabled={update.isPending}
        onCheckedChange={(next) => { save({ ...current, show_prices: next }); }}
      />
      {PARTS.map((part) => (
        <div key={part.key} className="mk-row">
          <span>{part.label}</span>
          <Select
            options={options}
            value={current.price_map[part.key] ?? NONE}
            onValueChange={(code) => {
              const rest = Object.fromEntries(Object.entries(current.price_map).filter(([k]) => k !== part.key));
              save({ ...current, price_map: code === NONE ? rest : { ...rest, [part.key]: code } });
            }}
          />
        </div>
      ))}
    </MkCard>
  );
}
