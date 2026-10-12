import { MessageCircle, Phone } from "lucide-react";
import { useState } from "react";

import { apiErrorOf, type LabContactLogEntry, type LabOrder, type LabVendor } from "@aarogyam/api-client";
import { ApiErrorNotice, formatDate, formatDateTime, formatRupees } from "@aarogyam/app-kit";
import { Button, DateInput, Drawer, Field, Select, TextInput, useToast } from "@sakalya/ui";

import { useClinic } from "../../clinic.js";
import { Skeleton, Timeline } from "../../components/mk/index.js";
import { OrderStatusTags, Tracker } from "./order-card.js";
import { useLabOrderById, useLabVendors, useLogLabContact, useMoveLabOrder, useRemindLab, useSetLabOrderStatus } from "./queries.js";
import { STAGES, planMove, reminderText, stageIndex, telLink, waLink } from "./stages.js";

const CHANNELS = [
  { value: "call", label: "Call" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "email", label: "Email" },
  { value: "visit", label: "Visit" },
] as const;

const OUTCOMES = [
  { value: "reached", label: "Spoke to someone" },
  { value: "no_answer", label: "No answer" },
  { value: "promised_date", label: "Lab promised a date" },
  { value: "other", label: "Other" },
] as const;

const EVENT_TITLE: Readonly<Record<string, string>> = {
  created: "Order created",
  status_changed: "Status changed",
  stage_changed: "Stage changed",
  due_changed: "Due date changed",
  reminded: "Reminder sent",
  reminder_skipped: "Reminder skipped",
  overdue: "Went overdue",
  contacted: "Lab contacted",
  item_added: "Item added",
  item_changed: "Item changed",
  item_removed: "Item removed",
};

type Reminded = { kind: "queued" } | { kind: "whatsapp"; reason: string; href: string | undefined };

/** One case in full: status and stage, items, the reminder, calling and logging the lab, and what has happened. */
export function OrderDrawer({ orderId, onClose }: { orderId: string | undefined; onClose: () => void }) {
  const order = useLabOrderById(orderId);
  return (
    <Drawer
      open={orderId !== undefined}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={order.data === undefined ? "Lab order" : `${order.data.number} · ${order.data.patient_name}`}
      description="Stage, items, reminders and calls"
      size="lg"
    >
      {order.isPending ? (
        <div role="status" aria-label="Loading the order">
          <Skeleton shape="block" />
        </div>
      ) : order.isError ? (
        <ApiErrorNotice
          title="Couldn't load this order"
          error={order.error}
          onRetry={() => {
            void order.refetch();
          }}
        />
      ) : (
        <OrderBody order={order.data} />
      )}
    </Drawer>
  );
}

function OrderBody({ order }: { order: LabOrder }) {
  const { can, access } = useClinic();
  const toast = useToast();
  const canWrite = can("labs.write");
  const vendors = useLabVendors();
  const vendor = vendors.data?.items.find((v) => v.id === order.vendor_id);
  const move = useMoveLabOrder();
  const setStatus = useSetLabOrderStatus();
  const remind = useRemindLab();
  const [reminded, setReminded] = useState<Reminded>();
  const [problem, setProblem] = useState<string>();
  const at = stageIndex(order);

  const run = (moves: ReturnType<typeof planMove>) => {
    setProblem(undefined);
    move.mutate(
      { order, moves },
      {
        onSuccess: () => {
          toast.show({ title: `${order.number} updated`, tone: "success" });
        },
        onError: (thrown) => {
          setProblem(apiErrorOf(thrown)?.message ?? "Couldn't change this order. Please try again.");
        },
      },
    );
  };
  const end = (status: "returned_for_rework" | "cancelled") => {
    setProblem(undefined);
    setStatus.mutate(
      { id: order.id, status },
      {
        onSuccess: () => {
          toast.show({ title: status === "cancelled" ? `${order.number} cancelled` : `${order.number} sent back for rework`, tone: "success" });
        },
        onError: (thrown) => {
          setProblem(apiErrorOf(thrown)?.message ?? "Couldn't change this order. Please try again.");
        },
      },
    );
  };

  const sendReminder = () => {
    setReminded(undefined);
    remind.mutate(order.id, {
      onSuccess: () => {
        setReminded({ kind: "queued" });
      },
      onError: (thrown) => {
        const whatsapp = order.contact_whatsapp && order.contact_phone != null;
        setReminded({
          kind: "whatsapp",
          reason: apiErrorOf(thrown)?.message ?? "The reminder couldn't be emailed.",
          href: whatsapp && order.contact_phone != null ? waLink(order.contact_phone, reminderText(order, access.name)) : undefined,
        });
      },
    });
  };

  const busy = move.isPending || setStatus.isPending;
  const open = order.status === "draft" || order.status === "sent" || order.status === "in_progress";
  return (
    <div className="lb-drawer">
      <section aria-labelledby="lb-d-stage">
        <h3 id="lb-d-stage" className="mk-flabel">
          Stage
        </h3>
        <div className="lb-tags">
          <OrderStatusTags order={order} />
        </div>
        <Tracker order={order} />
        {canWrite && at >= 0 && order.status !== "returned_for_rework" ? (
          <div className="lb-actions" role="group" aria-label="Move to">
            {([1, 2, 3, 4] as const).map((target) => {
              const moves = planMove(order, target);
              return (
                <button
                  key={target}
                  type="button"
                  className="lb-btn"
                  disabled={busy || moves.length === 0}
                  onClick={() => {
                    run(moves);
                  }}
                >
                  {STAGES[target]}
                </button>
              );
            })}
          </div>
        ) : null}
        {canWrite && (open || order.status === "received") ? (
          <div className="lb-actions">
            {order.status === "received" ? (
              <button
                type="button"
                className="lb-btn"
                disabled={busy}
                onClick={() => {
                  end("returned_for_rework");
                }}
              >
                Send back for rework
              </button>
            ) : null}
            {open ? (
              <button
                type="button"
                className="lb-btn"
                disabled={busy}
                onClick={() => {
                  end("cancelled");
                }}
              >
                Cancel order
              </button>
            ) : null}
          </div>
        ) : null}
        {problem === undefined ? null : (
          <p role="alert" className="lb-error">
            {problem}
          </p>
        )}
        <p className="lb-sub">
          {order.vendor_name ?? "Lab"}
          {order.sent_at == null ? "" : ` · sent ${formatDate(order.sent_at)}`}
          {order.due_on == null ? " · no due date" : ` · due ${formatDate(order.due_on)}`}
          {order.stage == null ? "" : ` · ${order.stage}`}
        </p>
        {order.instructions == null ? null : <p className="lb-note">{order.instructions}</p>}
      </section>

      <section aria-labelledby="lb-d-items">
        <h3 id="lb-d-items" className="mk-flabel">
          Items
        </h3>
        <table className="lb-table">
          <thead>
            <tr>
              <th scope="col">Work</th>
              <th scope="col">Teeth</th>
              <th scope="col">Shade</th>
              <th scope="col">Material</th>
              <th scope="col">Qty</th>
              {order.costs_visible ? <th scope="col">Cost</th> : null}
            </tr>
          </thead>
          <tbody>
            {order.items.map((item) => (
              <tr key={item.id}>
                <th scope="row">{item.work_type}</th>
                <td>{item.teeth.length === 0 ? "—" : item.teeth.join(", ")}</td>
                <td>{item.shade ?? "—"}</td>
                <td>{item.material ?? "—"}</td>
                <td>{item.qty}</td>
                {order.costs_visible ? <td>{item.unit_cost_paise == null ? "—" : formatRupees(item.unit_cost_paise * item.qty)}</td> : null}
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {canWrite ? (
        <section aria-labelledby="lb-d-remind">
          <h3 id="lb-d-remind" className="mk-flabel">
            Remind the lab
          </h3>
          <p className="lb-sub">The reminder names the work, teeth, shade and due date. It never names the patient.</p>
          <div className="lb-actions">
            <Button disabled={remind.isPending || (order.status !== "sent" && order.status !== "in_progress")} onClick={sendReminder} icon={<MessageCircle aria-hidden="true" size={15} />}>
              {remind.isPending ? "Sending…" : "Remind lab"}
            </Button>
          </div>
          {order.status !== "sent" && order.status !== "in_progress" ? <p className="lb-sub">Reminders go out once the work is at the lab.</p> : null}
          {reminded === undefined ? null : reminded.kind === "queued" ? (
            <p role="status" className="lb-result ok">
              Reminder emailed to {order.contact_name ?? order.vendor_name ?? "the lab"}.
            </p>
          ) : (
            <p role="status" className="lb-result">
              {reminded.reason}{" "}
              {reminded.href === undefined ? (
                "Add an email to the lab or call them."
              ) : (
                <a href={reminded.href} target="_blank" rel="noopener noreferrer">
                  Send on WhatsApp instead
                </a>
              )}
            </p>
          )}
        </section>
      ) : null}

      <ContactSection order={order} vendor={vendor} canWrite={canWrite} />

      <section aria-labelledby="lb-d-hist">
        <h3 id="lb-d-hist" className="mk-flabel">
          History
        </h3>
        <Timeline
          label="Order history"
          items={[...order.events]
            .reverse()
            .map((event, index) => ({
              id: `${String(index)}-${event.at}`,
              title: EVENT_TITLE[event.kind] ?? event.kind,
              detail: [event.to_status?.replaceAll("_", " "), event.stage, event.channel, event.outcome?.replaceAll("_", " "), event.due_on == null ? null : `due ${formatDate(event.due_on)}`, event.note]
                .filter((part) => part != null && part !== "")
                .join(" · "),
              when: formatDateTime(event.at),
            }))}
        />
      </section>
    </div>
  );
}

function ContactSection({ order, vendor, canWrite }: { order: LabOrder; vendor: LabVendor | undefined; canWrite: boolean }) {
  const toast = useToast();
  const log = useLogLabContact();
  const contacts = vendor?.contacts ?? [];
  const [who, setWho] = useState(order.contact_id ?? "none");
  const [channel, setChannel] = useState<LabContactLogEntry["channel"]>("call");
  const [outcome, setOutcome] = useState<NonNullable<LabContactLogEntry["outcome"]>>("reached");
  const [note, setNote] = useState("");
  const [promised, setPromised] = useState("");
  const [error, setError] = useState<string>();
  const person = contacts.find((c) => c.id === who);
  const phone = person?.phone ?? order.contact_phone ?? order.vendor_phone ?? null;

  const submit = () => {
    setError(undefined);
    if (outcome === "promised_date" && promised === "") {
      setError("Pick the date the lab promised.");
      return;
    }
    log.mutate(
      {
        id: order.id,
        entry: {
          channel,
          outcome,
          ...(who === "none" ? {} : { contact_id: who }),
          ...(note.trim() === "" ? {} : { note: note.trim() }),
          ...(outcome === "promised_date" ? { promised_on: promised } : {}),
        },
      },
      {
        onSuccess: () => {
          toast.show({ title: "Logged", tone: "success" });
          setNote("");
          setPromised("");
        },
        onError: (thrown) => {
          setError(apiErrorOf(thrown)?.message ?? "Couldn't log this. Please try again.");
        },
      },
    );
  };

  return (
    <section aria-labelledby="lb-d-contact">
      <h3 id="lb-d-contact" className="mk-flabel">
        Call and log
      </h3>
      <p className="lb-sub">
        {order.last_contacted_at == null ? "Not contacted yet." : `Last contacted ${formatDateTime(order.last_contacted_at)}${order.last_contacted_by_name == null ? "" : ` by ${order.last_contacted_by_name}`}.`}
      </p>
      <div className="lb-actions">
        {phone === null ? (
          <span className="lb-sub">No phone number on file.</span>
        ) : (
          <a className="lb-btn" href={telLink(phone)}>
            <Phone aria-hidden="true" />
            Call {person?.name ?? order.contact_name ?? order.vendor_name ?? "the lab"}
          </a>
        )}
      </div>
      {canWrite ? (
        <form
          className="lb-form"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <Field label="Who">
            <Select
              options={[{ value: "none", label: "The lab's main line" }, ...contacts.map((c) => ({ value: c.id, label: c.role == null ? c.name : `${c.name} (${c.role})` }))]}
              value={who}
              onValueChange={setWho}
            />
          </Field>
          <div className="lb-two">
            <Field label="How">
              <Select options={CHANNELS} value={channel} onValueChange={setChannel} />
            </Field>
            <Field label="What came of it">
              <Select options={OUTCOMES} value={outcome} onValueChange={setOutcome} />
            </Field>
          </div>
          {outcome === "promised_date" ? (
            <Field label="Promised date" hint="Becomes the due date and restarts reminders" required>
              <DateInput value={promised} onValueChange={setPromised} />
            </Field>
          ) : null}
          <Field label="Note">
            <TextInput
              value={note}
              maxLength={500}
              onChange={(event) => {
                setNote(event.currentTarget.value);
              }}
            />
          </Field>
          {error === undefined ? null : (
            <p role="alert" className="lb-error">
              {error}
            </p>
          )}
          <div className="lb-actions">
            <Button type="submit" variant="secondary" disabled={log.isPending}>
              {log.isPending ? "Saving…" : channel === "call" ? "Log call" : "Log contact"}
            </Button>
          </div>
        </form>
      ) : null}
    </section>
  );
}
