import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Send } from "lucide-react";
import { useId, useMemo, useRef, useState } from "react";

import { randomUuid, unwrap, type MessageTemplate } from "@aarogyam/api-client";
import { Pills, useToast } from "@sakalya/ui";

import { Empty, Kpi, MkCard } from "../../../components/mk/index.js";
import { useClinic } from "../../../clinic.js";
import { OfferPanel } from "./offer-panel.js";
import { useCampaigns, usePatientMessages, usePatientPicker, useTemplates, why } from "./queries.js";
import { StatusTag } from "./status.js";

/** Patients written to at once. The API takes 1 to 50. */
export const BROADCAST_CAP = 50;

type Mode = "one" | "broadcast" | "offer";

/** Templates whose text the sender writes (the others are fixed wording). */
const OWN_TEXT = ["care.note", "promo.offer"];
const LABEL: Record<string, string> = {
  "care.note": "Care note (your own text)",
  "reminder.follow_up": "Follow-up reminder",
  "promo.offer": "Offer note (your own text)",
};

export function PatientsTab() {
  const { can } = useClinic();
  const send = can("messages.send");
  const offer = can("campaigns.manage");
  const modes = [
    ...(send ? [{ value: "one" as const, label: "One patient" }, { value: "broadcast" as const, label: "Broadcast" }] : []),
    ...(offer ? [{ value: "offer" as const, label: "Offer" }] : []),
  ];
  const [chosen, setChosen] = useState<Mode>(modes[0]?.value ?? "one");
  const mode = modes.some((m) => m.value === chosen) ? chosen : (modes[0]?.value ?? "one");
  const campaigns = useCampaigns(offer);

  const totals = useMemo(() => {
    const sum = { sent: 0, queued: 0, skipped: 0, failed: 0 };
    for (const c of campaigns.data?.items ?? []) {
      for (const n of c.counts) {
        if (n.status === "sent") sum.sent += n.count;
        else if (n.status === "queued" || n.status === "sending") sum.queued += n.count;
        else if (n.status === "skipped") sum.skipped += n.count;
        else if (n.status === "failed") sum.failed += n.count;
      }
    }
    return sum;
  }, [campaigns.data]);

  return (
    <div className="ms-stack">
      {offer ? (
        <div className="mk-kpis" aria-label="Offer results">
          <Kpi label="Offers sent" value={campaigns.isPending ? "…" : totals.sent} />
          <Kpi label="Waiting to send" value={campaigns.isPending ? "…" : totals.queued} />
          <Kpi label="Skipped (no consent)" value={campaigns.isPending ? "…" : totals.skipped} />
          <Kpi label="Failed" value={campaigns.isPending ? "…" : totals.failed} warn={totals.failed > 0} />
        </div>
      ) : null}
      <Pills label="Kind of message" options={modes} value={mode} onValueChange={setChosen} />
      <p className="mk-hint ms-consent" role="note">
        Messages go only to patients who agreed to receive that kind of message. Patients who opted out, or who never agreed to offers, are skipped
        automatically, and every message shows its status.
      </p>
      {mode === "offer" ? <OfferPanel /> : <DirectPanel key={mode} mode={mode} />}
    </div>
  );
}

function DirectPanel({ mode }: { mode: "one" | "broadcast" }) {
  const { api, access, can } = useClinic();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [templateKey, setTemplateKey] = useState("");
  const [subject, setSubject] = useState("");
  const [text, setText] = useState("");
  const [result, setResult] = useState<{ queued: number; requested: number; already: number; ids: { id: string; name: string }[] } | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const batch = useRef(randomUuid());
  const ids = { search: useId(), template: useId(), subject: useId(), text: useId() };

  const canRead = can("patients.read");
  const patients = usePatientPicker(search, canRead);
  const templates = useTemplates(true);
  const approved = (templates.data?.items ?? []).filter((t) => t.status === "approved" && t.channel === "email" && (mode === "one" || t.key !== "promo.offer"));
  const template: MessageTemplate | undefined = approved.find((t) => t.key === templateKey) ?? approved[0];
  const ownText = template !== undefined && OWN_TEXT.includes(template.key);
  const first = picked[0] ?? null;
  const history = usePatientMessages(mode === "one" ? first : null);

  const toggle = (id: string) => {
    setResult(null);
    setPicked((now) => (mode === "one" ? [id] : now.includes(id) ? now.filter((x) => x !== id) : now.length >= BROADCAST_CAP ? now : [...now, id]));
  };
  const shown = patients.data?.items ?? [];
  const full = mode === "broadcast" && picked.length >= BROADCAST_CAP;

  const ready = template !== undefined && picked.length > 0 && (!ownText || (text.trim() !== "" && subject.trim() !== ""));
  const sendNow = useMutation({
    mutationFn: () =>
      unwrap(
        api.sendMessages({
          patient_ids: picked.slice(0, BROADCAST_CAP),
          channel: "email",
          template_key: template?.key ?? "",
          batch_id: batch.current,
          ...(ownText ? { body: text.trim(), variables: { subject: subject.trim() } } : {}),
        }),
      ),
    onSuccess: (queued) => {
      setFailure(null);
      setResult({ queued: queued.queued, requested: queued.requested, already: queued.already_queued, ids: picked.slice(0, BROADCAST_CAP).map((id) => ({ id, name: shown.find((p) => p.id === id)?.full_name ?? "Patient" })) });
      batch.current = randomUuid();
      setText("");
      setSubject("");
      void queryClient.invalidateQueries({ queryKey: ["messages", access.org_id, "patient"] });
      toast.show({ title: `Queued ${String(queued.queued)} message${queued.queued === 1 ? "" : "s"}`, tone: "success" });
    },
    onError: (thrown) => {
      setFailure(why(thrown));
    },
  });

  return (
    <div className="ms-grid">
      <MkCard
        title={mode === "one" ? "Pick a patient" : "Pick patients"}
        hint={mode === "broadcast" ? `${String(picked.length)} of up to ${String(BROADCAST_CAP)} chosen` : undefined}
        action={
          mode === "broadcast" ? (
            <button
              type="button"
              className="ms-link"
              onClick={() => {
                setResult(null);
                setPicked(picked.length > 0 ? [] : shown.slice(0, BROADCAST_CAP).map((p) => p.id));
              }}
            >
              {picked.length > 0 ? "Clear" : `Select first ${String(Math.min(BROADCAST_CAP, shown.length))}`}
            </button>
          ) : null
        }
      >
        {canRead ? (
          <>
            <label className="mk-flabel" htmlFor={ids.search}>
              Search patients
            </label>
            <input id={ids.search} className="mk-tin" value={search} placeholder="Name, number or phone" autoComplete="off" onChange={(e) => { setSearch(e.target.value); }} />
            <div className="ms-picker" role="group" aria-label="Patients" aria-busy={patients.isPending}>
              {patients.isPending ? <p className="mk-hint">Loading patients…</p> : null}
              {patients.isError ? <p role="alert" className="ms-error">Couldn't load patients. {why(patients.error)}</p> : null}
              {patients.isSuccess && shown.length === 0 ? <Empty title="No patients found">Try another name or number.</Empty> : null}
              {shown.map((p) => {
                const on = picked.includes(p.id);
                const blocked = !on && full;
                return (
                  <button key={p.id} type="button" className="ms-pick" aria-pressed={on} disabled={blocked} onClick={() => { toggle(p.id); }}>
                    <span className="ms-pick-name">{p.full_name}</span>
                    <span className="ms-pick-num">{p.number}</span>
                    {on ? <span aria-hidden="true">✓</span> : null}
                  </button>
                );
              })}
            </div>
            {full ? <p className="mk-hint" role="status">Up to {BROADCAST_CAP} patients in one send.</p> : null}
          </>
        ) : (
          <Empty title="You can't browse patients">Ask the owner for access to patients to pick who to write to.</Empty>
        )}
      </MkCard>

      <MkCard title="Message" hint={`${String(picked.length)} recipient${picked.length === 1 ? "" : "s"} · email`}>
        {templates.isPending ? <p className="mk-hint">Loading templates…</p> : null}
        {templates.isError ? <p role="alert" className="ms-error">Couldn't load templates. {why(templates.error)}</p> : null}
        {templates.isSuccess && approved.length === 0 ? (
          <Empty title="No approved templates">Templates must be approved before they can be sent.</Empty>
        ) : null}
        {template !== undefined ? (
          <>
            <label className="mk-flabel" htmlFor={ids.template}>
              Template
            </label>
            <select id={ids.template} className="mk-tin" value={template.key} onChange={(e) => { setTemplateKey(e.target.value); setResult(null); }}>
              {approved.map((t) => (
                <option key={t.id} value={t.key}>
                  {LABEL[t.key] ?? t.key}
                </option>
              ))}
            </select>
            {ownText ? (
              <>
                <label className="mk-flabel" htmlFor={ids.subject}>
                  Subject
                </label>
                <input id={ids.subject} className="mk-tin" maxLength={120} value={subject} onChange={(e) => { setSubject(e.target.value); }} />
                <label className="mk-flabel" htmlFor={ids.text}>
                  Email text
                </label>
                <textarea id={ids.text} className="mk-tin" rows={6} maxLength={5000} value={text} onChange={(e) => { setText(e.target.value); }} />
                <p className="mk-hint">Blank lines start a new paragraph. Don't put test results or diagnoses in an email.</p>
              </>
            ) : (
              <>
                <div className="mk-flabel">What they receive</div>
                <div className="mk-bubble">{template.body}</div>
              </>
            )}
          </>
        ) : null}
        {failure !== null ? (
          <p role="alert" className="ms-error">
            {failure}
          </p>
        ) : null}
        <button type="button" className="mk-btn mk-btn-primary ms-send" disabled={!ready || sendNow.isPending} onClick={() => { sendNow.mutate(); }}>
          <Send aria-hidden="true" />
          {sendNow.isPending ? "Sending…" : picked.length === 0 ? "Send" : `Send to ${String(picked.length)} patient${picked.length === 1 ? "" : "s"}`}
        </button>
        {result !== null ? (
          <div className="ms-result" role="status">
            <b>
              Queued {result.queued} of {result.requested}
            </b>
            {result.already > 0 ? ` · ${String(result.already)} already queued` : ""}
            {result.queued < result.requested - result.already ? ` · ${String(result.requested - result.already - result.queued)} not queued` : ""}
            {mode === "broadcast" ? <RecipientStatus ids={result.ids} /> : null}
          </div>
        ) : null}
        {mode === "one" && first !== null ? (
          <div className="ms-history">
            <div className="mk-flabel">Messages to this patient</div>
            {history.isPending ? <p className="mk-hint">Loading…</p> : null}
            {history.isError ? <p role="alert" className="ms-error">Couldn't load the messages. {why(history.error)}</p> : null}
            {history.isSuccess && history.data.items.length === 0 ? <p className="mk-hint">Nothing sent to this patient yet.</p> : null}
            <ul className="ms-statuses">
              {history.data?.items.map((m) => (
                <li key={m.id}>
                  <span>{LABEL[m.template_key] ?? m.template_key}</span>
                  <StatusTag status={m.status} reason={m.skip_reason} delivery={m.delivery} />
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </MkCard>
    </div>
  );
}

/** Status of the newest message to each of the first few patients of a broadcast. */
function RecipientStatus({ ids }: { ids: readonly { id: string; name: string }[] }) {
  const shown = ids.slice(0, 5);
  return (
    <ul className="ms-statuses" aria-label="Status per patient">
      {shown.map((p) => (
        <RecipientRow key={p.id} id={p.id} name={p.name} />
      ))}
      {ids.length > shown.length ? <li className="mk-hint">and {ids.length - shown.length} more</li> : null}
    </ul>
  );
}

function RecipientRow({ id, name }: { id: string; name: string }) {
  const { data, isError } = usePatientMessages(id);
  const newest = data?.items[0];
  return (
    <li>
      <span>{name}</span>
      {isError ? <StatusTag status="failed" /> : newest === undefined ? <StatusTag status="queued" /> : <StatusTag status={newest.status} reason={newest.skip_reason} delivery={newest.delivery} />}
    </li>
  );
}
