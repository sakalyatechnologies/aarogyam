import { MessageCircle } from "lucide-react";
import { useState } from "react";

import { apiErrorOf, type LabReminders } from "@aarogyam/api-client";
import { Button } from "@sakalya/ui";

import { Segments } from "../../components/mk/index.js";
import { useRemindLabs } from "./queries.js";

type Channel = "email" | "whatsapp";
const CHANNELS = [
  { value: "email", label: "Email" },
  { value: "whatsapp", label: "WhatsApp" },
] as const;
const SKIP_REASON: Readonly<Record<string, string>> = {
  not_at_the_lab: "isn't at the lab yet",
  no_email: "the lab has no email",
  no_phone: "the lab has no phone number",
};

/**
 * Choose several orders and remind their labs in one go (one message per lab). Needs `labs.write`.
 * The reminder names the work, never the patient; the result lists each lab, with a WhatsApp link when that channel was chosen.
 */
export function RemindLabsBar({
  picking,
  picked,
  orderIds,
  onPicking,
  onPickAll,
  onDone,
}: {
  picking: boolean;
  picked: readonly string[];
  /** The orders on screen that are at a lab, for "Select all". */
  orderIds: readonly string[];
  onPicking: (next: boolean) => void;
  onPickAll: (ids: readonly string[]) => void;
  onDone: () => void;
}) {
  const remind = useRemindLabs();
  const [channel, setChannel] = useState<Channel>("email");
  const [result, setResult] = useState<LabReminders>();
  const [problem, setProblem] = useState<string>();

  const send = () => {
    setProblem(undefined);
    setResult(undefined);
    remind.mutate(
      { channel, order_ids: [...picked] },
      {
        onSuccess: (done) => {
          setResult(done);
          onDone();
        },
        onError: (thrown) => {
          setProblem(apiErrorOf(thrown)?.message ?? "Couldn't remind the labs. Please try again.");
        },
      },
    );
  };

  return (
    <div className="lb-remind">
      <div className="lb-actions">
        <Button
          variant="secondary"
          aria-pressed={picking}
          onClick={() => {
            onPicking(!picking);
            setResult(undefined);
            setProblem(undefined);
          }}
        >
          {picking ? "Stop selecting" : "Select orders"}
        </Button>
        {picking ? (
          <>
            <Button
              variant="secondary"
              onClick={() => {
                onPickAll(picked.length === orderIds.length ? [] : orderIds);
              }}
            >
              {picked.length === orderIds.length && orderIds.length > 0 ? "Clear selection" : "Select all at labs"}
            </Button>
            <Segments label="Reminder channel" options={CHANNELS} value={channel} onChange={setChannel} />
            <Button disabled={picked.length === 0 || picked.length > 50 || remind.isPending} onClick={send} icon={<MessageCircle aria-hidden="true" size={15} />}>
              {remind.isPending ? "Sending…" : "Remind labs"}
            </Button>
            <span className="lb-sub" role="status">
              {picked.length} selected
            </span>
          </>
        ) : null}
      </div>
      {picking ? <p className="lb-sub">One reminder per lab. It names the work, teeth, shade and due date, never the patient.</p> : null}
      {problem === undefined ? null : (
        <p role="alert" className="lb-error">
          {problem}
        </p>
      )}
      {result === undefined ? null : (
        <section aria-label="Reminder results" className="lb-result ok">
          <ul>
            {result.vendors.map((v) => (
              <li key={v.vendor_id}>
                <b>{v.vendor_name}</b>: {v.order_numbers.join(", ")}.{" "}
                {v.wa_link == null ? (
                  `Reminder emailed${v.contact_name == null ? "" : ` to ${v.contact_name}`}.`
                ) : (
                  <a href={v.wa_link} target="_blank" rel="noopener noreferrer" aria-label={`Open WhatsApp for ${v.vendor_name}`}>
                    Open WhatsApp
                  </a>
                )}
              </li>
            ))}
            {result.skipped.map((s) => (
              <li key={s.order_id}>
                {s.number} skipped: {SKIP_REASON[s.reason] ?? s.reason}.
              </li>
            ))}
          </ul>
          {result.vendors.length === 0 ? <p>No reminders were sent.</p> : null}
        </section>
      )}
    </div>
  );
}
