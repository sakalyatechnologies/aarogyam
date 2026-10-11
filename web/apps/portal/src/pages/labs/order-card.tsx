import { ArrowRight, Phone } from "lucide-react";

import type { LabOrder } from "@aarogyam/api-client";
import { formatDate, formatRupees } from "@aarogyam/app-kit";

import { MkAvatar, Tag } from "../../components/mk/index.js";
import { PIPELINE_LABEL, STAGES, nextStage, stageIndex, telLink } from "./stages.js";

/** The five steps as a row of bars; the step the case is on is named for screen readers too. */
export function Tracker({ order }: { order: Pick<LabOrder, "status" | "pipeline_stage" | "stage"> }) {
  const at = stageIndex(order);
  return (
    <ol className={`lb-track ${at < 0 ? "off" : ""}`} aria-label={at < 0 ? "Progress: cancelled" : `Progress: ${STAGES[at] ?? ""}`}>
      {STAGES.map((name, i) => (
        <li key={name} className={i <= at ? "on" : ""} {...(i === at ? { "aria-current": "step" as const } : {})}>
          <span className="lb-bar" aria-hidden="true" />
          <span className="lb-step">{name}</span>
        </li>
      ))}
    </ol>
  );
}

export function itemSummary(item: LabOrder["items"][number]): string {
  return [item.work_type, item.teeth.length > 0 ? item.teeth.join(", ") : null, item.shade].filter((part) => part !== null).join(" · ");
}

export function OrderStatusTags({ order }: { order: Pick<LabOrder, "late" | "days_late" | "pipeline_stage"> }) {
  return (
    <>
      {order.late ? <Tag tone="down">{order.days_late == null ? "Late" : `Late ${String(order.days_late)} d`}</Tag> : null}
      <Tag tone={order.pipeline_stage === "fitted" ? "done" : order.pipeline_stage === "cancelled" || order.pipeline_stage === "rework" ? "neutral" : "next"}>
        {PIPELINE_LABEL[order.pipeline_stage]}
      </Tag>
    </>
  );
}

/** One case: who and what, the tracker, and the quick next step. Opening it shows everything else. */
export function OrderCard({
  order,
  onOpen,
  onNext,
  busy,
}: {
  order: LabOrder;
  onOpen: () => void;
  /** Present for roles that may move cases. */
  onNext?: ((target: 1 | 2 | 3 | 4) => void) | undefined;
  busy: boolean;
}) {
  const next = onNext === undefined ? null : nextStage(order);
  const phone = order.contact_phone ?? order.vendor_phone ?? null;
  const callee = order.contact_name?.split(" ")[0] ?? order.vendor_name ?? "the lab";
  return (
    <li className="lb-card">
      <div className="lb-card-h">
        <MkAvatar name={order.patient_name} />
        <div className="lb-card-t">
          <button type="button" className="lb-open" onClick={onOpen}>
            {order.patient_name}
          </button>
          <span className="lb-sub">
            {order.number} · {order.items.length} {order.items.length === 1 ? "item" : "items"}
          </span>
        </div>
        <div className="lb-tags">
          <OrderStatusTags order={order} />
        </div>
      </div>
      <ul className="lb-items" aria-label="Items">
        {order.items.map((item) => (
          <li key={item.id}>
            <Tag>{itemSummary(item)}</Tag>
          </li>
        ))}
      </ul>
      <p className="lb-sub">
        {order.vendor_name ?? "Lab"}
        {order.sent_at == null ? "" : ` · sent ${formatDate(order.sent_at)}`}
        {order.due_on == null ? "" : ` · due ${formatDate(order.due_on)}`}
        {order.costs_visible && order.items.some((i) => i.unit_cost_paise != null)
          ? ` · ${formatRupees(order.items.reduce((sum, i) => sum + (i.unit_cost_paise ?? 0) * i.qty, 0))}`
          : ""}
      </p>
      <Tracker order={order} />
      <div className="lb-actions">
        {next === null || onNext === undefined ? null : (
          <button
            type="button"
            className="lb-btn dark"
            disabled={busy}
            aria-label={`Mark ${next.label}, ${order.number}`}
            onClick={() => {
              onNext(next.target);
            }}
          >
            Mark {next.label}
            <ArrowRight aria-hidden="true" />
          </button>
        )}
        <button type="button" className="lb-btn" aria-label={`Details of ${order.number}`} onClick={onOpen}>
          Details
        </button>
        {phone === null ? null : (
          <a className="lb-btn" href={telLink(phone)} aria-label={`Call ${callee} about ${order.number}`}>
            <Phone aria-hidden="true" />
            Call {callee}
          </a>
        )}
      </div>
    </li>
  );
}
