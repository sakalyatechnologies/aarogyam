import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { apiErrorOf, paise, unwrap, type OfferSettings } from "@aarogyam/api-client";
import { ApiErrorNotice } from "@aarogyam/app-kit";
import { Field, Select, TextInput, useToast } from "@sakalya/ui";

import { MkCard, Toggle } from "../../components/mk/index.js";
import { SkeletonRows } from "../../components/skeleton-rows.js";
import { useClinic } from "../../clinic.js";

type Kind = OfferSettings["patient_offer"]["kind"];
type Caps = OfferSettings["caps"]["default"];

const KIND_OPTIONS = [
  { value: "percent_bps", label: "Percent off" },
  { value: "fixed", label: "Rupees off" },
];
const asKind = (value: string): Kind => (value === "fixed" ? "fixed" : "percent_bps");

/** A whole number field: `unit` says how the stored number is shown (percent from basis points, rupees from paise). */
function NumberField({ label, hint, unit, value, onValue }: { label: string; hint?: string; unit: "percent" | "rupees" | "days" | "count"; value: number; onValue: (stored: number) => void }) {
  const shown = unit === "percent" || unit === "rupees" ? value / 100 : value;
  const [text, setText] = useState(String(shown));
  const [lastShown, setLastShown] = useState(shown);
  if (lastShown !== shown) {
    // The saved value changed under us (a rollback): show it.
    setLastShown(shown);
    setText(String(shown));
  }
  return (
    <Field label={label} {...(hint === undefined ? {} : { hint })}>
      <TextInput
        type="number"
        inputMode="decimal"
        min={0}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          const n = Number(event.target.value);
          if (event.target.value.trim() !== "" && Number.isFinite(n) && n >= 0) {
            const stored = unit === "percent" || unit === "rupees" ? Math.round(n * 100) : Math.round(n);
            setLastShown(unit === "percent" || unit === "rupees" ? stored / 100 : stored);
            onValue(stored);
          }
        }}
      />
    </Field>
  );
}

function SwitchRow({ title, text, checked, onChange }: { title: string; text: string; checked: boolean; onChange: (next: boolean) => void }) {
  return (
    <div className="mk-setrow">
      <div>
        <b>{title}</b>
        <p>{text}</p>
      </div>
      <Toggle checked={checked} label={title} onChange={onChange} />
    </div>
  );
}

function CapsFields({ title, caps, onChange }: { title: string; caps: Caps; onChange: (next: Caps) => void }) {
  return (
    <fieldset className="st-fieldset" style={{ border: 0, padding: 0, margin: "8px 0 0" }}>
      <legend style={{ fontWeight: 600 }}>{title}</legend>
      <NumberField label="Highest percent" unit="percent" value={caps.max_percent_bps} onValue={(v) => { onChange({ ...caps, max_percent_bps: v }); }} />
      <NumberField label="Highest rupee amount (₹)" unit="rupees" value={caps.max_fixed_paise} onValue={(v) => { onChange({ ...caps, max_fixed_paise: paise.parse(v) }); }} />
      <NumberField label="Longest validity (days)" unit="days" value={caps.max_valid_days} onValue={(v) => { onChange({ ...caps, max_valid_days: v }); }} />
      <NumberField label="Most one code may take off (₹)" unit="rupees" value={caps.max_discount_paise} onValue={(v) => { onChange({ ...caps, max_discount_paise: paise.parse(v) }); }} />
    </fieldset>
  );
}

/** Settings, "Offers": what a doctor's one-tap offer and referral code give, and each role's limits (owner only). */
export function OffersPanel() {
  const { api, access } = useClinic();
  const key = ["offer-settings", access.org_id];
  const loaded = useQuery({ queryKey: key, queryFn: ({ signal }) => unwrap(api.getOfferSettings({ signal })) });
  if (loaded.data === undefined) {
    return (
      <MkCard title="Offers" hint="What doctors can give patients, and the limits">
        {loaded.isError ? <ApiErrorNotice title="Couldn't load offer settings" error={loaded.error} onRetry={() => void loaded.refetch()} /> : <SkeletonRows count={4} label="Loading offer settings" />}
      </MkCard>
    );
  }
  return <OffersForm key={JSON.stringify(loaded.data)} saved={loaded.data} queryKey={key} />;
}

function OffersForm({ saved, queryKey }: { saved: OfferSettings; queryKey: readonly unknown[] }) {
  const { api } = useClinic();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [draft, setDraft] = useState(saved);
  const [problem, setProblem] = useState<string>();
  const save = useMutation({
    mutationFn: (next: OfferSettings) => unwrap(api.saveOfferSettings(next)),
    onSuccess: (stored) => {
      setProblem(undefined);
      queryClient.setQueryData(queryKey, stored);
      toast.show({ title: "Offer settings saved", tone: "success" });
    },
    onError: (thrown) => {
      // Roll back to what the clinic has saved, and say what was wrong.
      setDraft(saved);
      const message = apiErrorOf(thrown)?.message ?? "Couldn't save that. Please try again.";
      setProblem(message);
      toast.show({ title: message, tone: "danger" });
    },
  });
  const offer = draft.patient_offer;
  const referral = draft.referral;
  const reward = referral.reward;
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  return (
    <div className="st-two">
      <MkCard title="Patient offer" hint="The one-tap offer on the Done screen">
        <SwitchRow title="Doctors can give an offer" text="Shows the offer chip after a visit" checked={offer.enabled} onChange={(v) => { setDraft({ ...draft, patient_offer: { ...offer, enabled: v } }); }} />
        <Field label="Type">
          <Select options={KIND_OPTIONS} value={offer.kind} onValueChange={(v) => { setDraft({ ...draft, patient_offer: { ...offer, kind: asKind(v) } }); }} />
        </Field>
        <NumberField label={offer.kind === "percent_bps" ? "Percent" : "Rupees (₹)"} unit={offer.kind === "percent_bps" ? "percent" : "rupees"} value={offer.value} onValue={(v) => { setDraft({ ...draft, patient_offer: { ...offer, value: v } }); }} />
        <NumberField label="Valid for (days)" unit="days" value={offer.valid_days} onValue={(v) => { setDraft({ ...draft, patient_offer: { ...offer, valid_days: v } }); }} />
      </MkCard>
      <MkCard title="Referral code" hint="What a friend gets, and the thank-you for the patient who referred them">
        <SwitchRow title="Doctors can give a referral code" text="Shows the referral chip after a visit" checked={referral.enabled} onChange={(v) => { setDraft({ ...draft, referral: { ...referral, enabled: v } }); }} />
        <Field label="Friend gets">
          <Select options={KIND_OPTIONS} value={referral.friend_kind} onValueChange={(v) => { setDraft({ ...draft, referral: { ...referral, friend_kind: asKind(v) } }); }} />
        </Field>
        <NumberField label={referral.friend_kind === "percent_bps" ? "Percent" : "Rupees (₹)"} unit={referral.friend_kind === "percent_bps" ? "percent" : "rupees"} value={referral.friend_value} onValue={(v) => { setDraft({ ...draft, referral: { ...referral, friend_value: v } }); }} />
        <NumberField label="Most a friend's discount can be (₹)" unit="rupees" value={referral.friend_max_discount_paise} onValue={(v) => { setDraft({ ...draft, referral: { ...referral, friend_max_discount_paise: paise.parse(v) } }); }} />
        <NumberField label="Valid for (days)" unit="days" value={referral.valid_days} onValue={(v) => { setDraft({ ...draft, referral: { ...referral, valid_days: v } }); }} />
        <NumberField label="Friends who can use one code" unit="count" value={referral.max_uses} onValue={(v) => { setDraft({ ...draft, referral: { ...referral, max_uses: v } }); }} />
        <SwitchRow title="Thank the patient who referred" text="They get a reward code when the friend pays" checked={reward.enabled} onChange={(v) => { setDraft({ ...draft, referral: { ...referral, reward: { ...reward, enabled: v } } }); }} />
        <Field label="Reward type">
          <Select options={KIND_OPTIONS} value={reward.kind} onValueChange={(v) => { setDraft({ ...draft, referral: { ...referral, reward: { ...reward, kind: asKind(v) } } }); }} />
        </Field>
        <NumberField label={reward.kind === "percent_bps" ? "Reward percent" : "Reward rupees (₹)"} unit={reward.kind === "percent_bps" ? "percent" : "rupees"} value={reward.value} onValue={(v) => { setDraft({ ...draft, referral: { ...referral, reward: { ...reward, value: v } } }); }} />
        <NumberField label="Reward valid for (days)" unit="days" value={reward.valid_days} onValue={(v) => { setDraft({ ...draft, referral: { ...referral, reward: { ...reward, valid_days: v } } }); }} />
        <NumberField label="Rewards per patient each month" unit="count" value={reward.max_per_month} onValue={(v) => { setDraft({ ...draft, referral: { ...referral, reward: { ...reward, max_per_month: v } } }); }} />
        <NumberField label="Friend's bill needed for a reward (₹)" unit="rupees" value={reward.min_bill_paise} onValue={(v) => { setDraft({ ...draft, referral: { ...referral, reward: { ...reward, min_bill_paise: paise.parse(v) } } }); }} />
        <NumberField label="Most a reward can be (₹)" unit="rupees" value={reward.max_discount_paise} onValue={(v) => { setDraft({ ...draft, referral: { ...referral, reward: { ...reward, max_discount_paise: paise.parse(v) } } }); }} />
      </MkCard>
      <MkCard title="Limits" hint="The most a person can give. Roles with their own row keep it.">
        <CapsFields title="Everyone by default" caps={draft.caps.default} onChange={(next) => { setDraft({ ...draft, caps: { ...draft.caps, default: next } }); }} />
        <CapsFields title="Owner" caps={draft.caps.owner} onChange={(next) => { setDraft({ ...draft, caps: { ...draft.caps, owner: next } }); }} />
        <div style={{ marginTop: 12 }}>
          <button
            type="button"
            className="mk-btn mk-btn-primary"
            disabled={!dirty || save.isPending}
            onClick={() => {
              save.mutate(draft);
            }}
          >
            {save.isPending ? "Saving…" : "Save offer settings"}
          </button>
          {problem === undefined ? null : (
            <p role="alert" className="mk-hint" style={{ color: "var(--red)" }}>
              Not saved. {problem}
            </p>
          )}
        </div>
      </MkCard>
    </div>
  );
}
