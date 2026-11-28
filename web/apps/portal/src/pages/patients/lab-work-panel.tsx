import { useState } from "react";
import { Link } from "react-router";

import type { PatientId } from "@aarogyam/api-client";
import { ApiErrorNotice, formatDate } from "@aarogyam/app-kit";

import { useClinic } from "../../clinic.js";
import { Empty } from "../../components/mk/index.js";
import { SkeletonRows } from "../../components/skeleton-rows.js";
import { NewOrderDialog } from "../labs/new-order-dialog.js";
import { OrderStatusTags, Tracker, itemSummary } from "../labs/order-card.js";
import { useLabOrders } from "../labs/queries.js";
import { usePatient } from "../../queries.js";

/** The patient's work at outside labs, with a way to send a new case. The lab page opens an order by its ID. */
export function LabWorkPanel({ patientId }: { patientId: PatientId }) {
  const patient = usePatient(patientId).data;
  const { can } = useClinic();
  const orders = useLabOrders({ patientId });
  const [sending, setSending] = useState(false);
  return (
    <div className="flex flex-col gap-4">
      {can("labs.write") ? (
        <div>
          <button
            type="button"
            className="mk-btn mk-btn-primary"
            onClick={() => {
              setSending(true);
            }}
          >
            Send to lab
          </button>
        </div>
      ) : null}
      {orders.isPending ? (
        <SkeletonRows label="Loading lab work" />
      ) : orders.isError ? (
        <ApiErrorNotice title="Couldn't load lab work" error={orders.error} onRetry={() => void orders.refetch()} />
      ) : orders.data.items.length === 0 ? (
        <Empty title="No lab work yet">Cases sent to a lab for this patient will appear here.</Empty>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {orders.data.items.map((order) => (
            <li key={order.id} className="flex flex-col gap-2 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <Link to={`/labs?order=${encodeURIComponent(order.id)}`} className="font-bold">
                  {order.number}
                </Link>
                <span className="text-sm text-muted">
                  {order.vendor_name ?? "Lab"}
                  {order.due_on == null ? "" : ` · due ${formatDate(order.due_on)}`}
                </span>
                <OrderStatusTags order={order} />
              </div>
              <div className="text-sm">{order.items.map(itemSummary).join("; ")}</div>
              <Tracker order={order} />
            </li>
          ))}
        </ul>
      )}
      {sending && patient !== undefined ? (
        <NewOrderDialog
          open
          initialPatient={patient}
          onClose={() => {
            setSending(false);
          }}
        />
      ) : null}
    </div>
  );
}
