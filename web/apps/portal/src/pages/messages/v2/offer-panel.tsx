import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CalendarClock } from "lucide-react";
import { useId, useState } from "react";

import { unwrap, type AudienceFilter, type Campaign } from "@aarogyam/api-client";
import { useToast } from "@sakalya/ui";

import { Empty, MkCard, Tag } from "../../../components/mk/index.js";
import { useClinic } from "../../../clinic.js";
import { useAudiencePreview, useCampaigns, useDebounced, useTemplates, why } from "./queries.js";
import { StatusTag } from "./status.js";

type Kind = "all_active" | "last_visit" | "birthday_month" | "age_band" | "sex";

const KINDS: readonly { value: Kind; label: string }[] = [
  { value: "all_active", label: "All active patients" },
  { value: "last_visit", label: "Not seen since a date" },
  { value: "birthday_month", label: "Birthday in a month" },
  { value: "age_band", label: "An age band" },
  { value: "sex", label: "Women, men or others" },
];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

interface Draft {
  kind: Kind;
  before: string;
  month: string;
  min: string;
  max: string;
  sex: string;
}

/** The API filter for what is typed, or null while it is not complete enough to count. */
function filterOf(d: Draft): AudienceFilter | null {
  switch (d.kind) {
    case "all_active":
      return { kind: "all_active" };
    case "last_visit":
      return /^\d{4}-\d{2}-\d{2}$/.test(d.before) ? { kind: "last_visit", before: d.before } : null;
    case "birthday_month":
      return { kind: "birthday_month", month: Number(d.month) };
    case "age_band": {
      const min = d.min === "" ? null : Number(d.min);
      const max = d.max === "" ? null : Number(d.max);
      if ((min === null && max === null) || (min !== null && max !== null && min > max)) return null;
      return { kind: "age_band", ...(min === null ? {} : { min }), ...(max === null ? {} : { max }) };
    }
    case "sex":
      return { kind: "sex", sex: d.sex };
  }
}

const sixMonthsAgo = (): string => {
  const d = new Date();
  d.setMonth(d.getMonth() - 6);
  return d.toISOString().slice(0, 10);
};

/** An offer is a campaign: choose who, see how many, write it, then schedule with the token of that count. */
export function OfferPanel() {
  const { api, access } = useClinic();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Draft>({ kind: "all_active", before: sixMonthsAgo(), month: String(new Date().getMonth() + 1), min: "", max: "", sex: "female" });
  const [name, setName] = useState("");
  const [offer, setOffer] = useState("");
  const [failure, setFailure] = useState<string | null>(null);
  const ids = { kind: useId(), date: useId(), month: useId(), min: useId(), max: useId(), sex: useId(), name: useId(), offer: useId() };

  const wanted = filterOf(draft);
  // Typing an age should not count on every key.
  const settled = useDebounced(draft, 300);
  const filter = filterOf(settled);
  const preview = useAudiencePreview(filter);
  const counting = wanted !== null && (settled !== draft || preview.isFetching);
  const token = !counting && preview.isSuccess ? preview.data : null;

  const templates = useTemplates(true);
  const template = templates.data?.items.find((t) => t.key === "promo.offer" && t.status === "approved" && t.channel === "email");
  const campaigns = useCampaigns(true);

  const schedule = useMutation({
    mutationFn: async () => {
      // Without a fresh preview there is nothing to prove the count: refuse before any request.
      if (token === null || filter === null || template === undefined) throw new Error("Preview the audience first.");
      const audience = await unwrap(api.createAudience({ name: name.trim(), filter }));
      const made = await unwrap(api.createCampaign({ audience_id: audience.id, template_id: template.id, channel: "email", name: name.trim(), offer_text: offer.trim() }));
      return unwrap(api.scheduleCampaign(made.id, { count_token: token.count_token }));
    },
    onSuccess: (done) => {
      setFailure(null);
      setName("");
      setOffer("");
      toast.show({ title: `Offer scheduled for ${String(done.scheduled_count ?? 0)} patients`, tone: "success" });
      void queryClient.invalidateQueries({ queryKey: ["messages", access.org_id, "campaigns"] });
    },
    onError: (thrown) => {
      setFailure(why(thrown));
      // A stale count (409) needs a new preview.
      void queryClient.invalidateQueries({ queryKey: ["messages", access.org_id, "preview"] });
    },
  });
  const cancel = useMutation({
    mutationFn: (id: string) => unwrap(api.cancelCampaign(id)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["messages", access.org_id, "campaigns"] }),
    onError: (thrown) => {
      setFailure(why(thrown));
    },
  });

  const set = (changes: Partial<Draft>) => {
    setFailure(null);
    setDraft((d) => ({ ...d, ...changes }));
  };
  const ready = token !== null && token.count > 0 && name.trim() !== "" && offer.trim() !== "" && template !== undefined;

  return (
    <div className="ms-grid">
      <MkCard title="Who gets the offer" hint="Only patients who agreed to offers will receive it.">
        <label className="mk-flabel" htmlFor={ids.kind}>
          Audience
        </label>
        <select id={ids.kind} className="mk-tin" value={draft.kind} onChange={(e) => {
          const kind = KINDS.find((k) => k.value === e.target.value)?.value;
          if (kind !== undefined) set({ kind });
        }}>
          {KINDS.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </select>
        {draft.kind === "last_visit" ? (
          <>
            <label className="mk-flabel" htmlFor={ids.date}>
              Last visit before
            </label>
            <input id={ids.date} type="date" className="mk-tin" value={draft.before} onChange={(e) => { set({ before: e.target.value }); }} />
          </>
        ) : null}
        {draft.kind === "birthday_month" ? (
          <>
            <label className="mk-flabel" htmlFor={ids.month}>
              Month
            </label>
            <select id={ids.month} className="mk-tin" value={draft.month} onChange={(e) => { set({ month: e.target.value }); }}>
              {MONTHS.map((m, i) => (
                <option key={m} value={String(i + 1)}>
                  {m}
                </option>
              ))}
            </select>
          </>
        ) : null}
        {draft.kind === "age_band" ? (
          <div className="ms-two">
            <div>
              <label className="mk-flabel" htmlFor={ids.min}>
                Youngest (years)
              </label>
              <input id={ids.min} type="number" min={0} max={120} className="mk-tin" value={draft.min} onChange={(e) => { set({ min: e.target.value }); }} />
            </div>
            <div>
              <label className="mk-flabel" htmlFor={ids.max}>
                Oldest (years)
              </label>
              <input id={ids.max} type="number" min={0} max={120} className="mk-tin" value={draft.max} onChange={(e) => { set({ max: e.target.value }); }} />
            </div>
          </div>
        ) : null}
        {draft.kind === "sex" ? (
          <>
            <label className="mk-flabel" htmlFor={ids.sex}>
              Patients who are
            </label>
            <select id={ids.sex} className="mk-tin" value={draft.sex} onChange={(e) => { set({ sex: e.target.value }); }}>
              <option value="female">Women</option>
              <option value="male">Men</option>
              <option value="other">Other</option>
            </select>
          </>
        ) : null}
        <div className="ms-count" role="status" aria-live="polite">
          {wanted === null ? (
            <span className="mk-hint">Complete the filter to see how many patients match.</span>
          ) : counting ? (
            <span className="mk-hint">Counting…</span>
          ) : preview.isError ? (
            <span className="ms-error" role="alert">
              Couldn't count the audience. {why(preview.error)}
            </span>
          ) : preview.isSuccess ? (
            <>
              <b className="ms-count-n">{preview.data.count}</b> patients match
            </>
          ) : null}
        </div>
      </MkCard>

      <MkCard title="The offer" hint="It is sent by email to each patient who agreed to offers; anyone can reply STOP.">
        <label className="mk-flabel" htmlFor={ids.name}>
          Offer name
        </label>
        <input id={ids.name} className="mk-tin" maxLength={80} value={name} placeholder="Diwali cleaning offer" onChange={(e) => { setName(e.target.value); }} />
        <label className="mk-flabel" htmlFor={ids.offer}>
          Offer text
        </label>
        <textarea id={ids.offer} className="mk-tin" rows={5} maxLength={1000} value={offer} placeholder="15% off teeth cleaning until 31 October. Reply to this email to book a slot." onChange={(e) => { setOffer(e.target.value); }} />
        {offer.trim() !== "" ? <div className="mk-bubble">{offer.trim()}</div> : null}
        {templates.isSuccess && template === undefined ? <p className="ms-error" role="alert">There is no approved offer template yet, so offers can't be sent.</p> : null}
        {failure !== null ? (
          <p role="alert" className="ms-error">
            {failure}
          </p>
        ) : null}
        <button type="button" className="mk-btn mk-btn-primary ms-send" disabled={!ready || schedule.isPending} onClick={() => { schedule.mutate(); }}>
          <CalendarClock aria-hidden="true" />
          {schedule.isPending ? "Scheduling…" : token === null ? "Schedule offer" : `Schedule offer to ${String(token.count)} patients`}
        </button>
        {token === null && wanted !== null ? <p className="mk-hint">Scheduling needs a fresh count of the audience.</p> : null}
      </MkCard>

      <div className="ms-wide">
        <MkCard title="Offers">
          {campaigns.isPending ? <p className="mk-hint">Loading offers…</p> : null}
          {campaigns.isError ? <p role="alert" className="ms-error">Couldn't load offers. {why(campaigns.error)}</p> : null}
          {campaigns.isSuccess && campaigns.data.items.length === 0 ? <Empty title="No offers yet">An offer you schedule appears here with its results.</Empty> : null}
          <ul className="ms-campaigns">
            {campaigns.data?.items.map((c) => (
              <CampaignRow key={c.id} campaign={c} busy={cancel.isPending} onCancel={() => { cancel.mutate(c.id); }} />
            ))}
          </ul>
        </MkCard>
      </div>
    </div>
  );
}

function CampaignRow({ campaign, busy, onCancel }: { campaign: Campaign; busy: boolean; onCancel: () => void }) {
  const open = campaign.status === "draft" || campaign.status === "scheduled";
  return (
    <li className="ms-campaign">
      <div>
        <b>{campaign.name}</b>
        <div className="mk-hint">
          {campaign.scheduled_count == null ? "Not scheduled" : `${String(campaign.scheduled_count)} patients`} · {campaign.channel}
        </div>
        <div className="ms-counts">
          {campaign.counts.map((n) => (
            <span key={`${n.status}-${n.skip_reason ?? ""}`}>
              {n.count} <StatusTag status={n.status} reason={n.skip_reason} />
            </span>
          ))}
        </div>
      </div>
      <div className="ms-campaign-end">
        <Tag tone={campaign.status === "sent" ? "done" : campaign.status === "cancelled" ? "neutral" : "wait"}>{campaign.status.charAt(0).toUpperCase() + campaign.status.slice(1)}</Tag>
        {open ? (
          <button type="button" className="ms-link" disabled={busy} onClick={onCancel} aria-label={`Cancel ${campaign.name}`}>
            Cancel
          </button>
        ) : null}
      </div>
    </li>
  );
}
