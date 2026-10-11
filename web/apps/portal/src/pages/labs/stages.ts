/** The five steps the front desk follows on a lab case, and how they map onto the API's status, pipeline stage and stage text. */

import type { LabOrder } from "@aarogyam/api-client";

export const STAGES = ["Impression", "Production", "Trial", "Final", "Delivered"] as const;
export type StageName = (typeof STAGES)[number];

type Shape = Pick<LabOrder, "status" | "pipeline_stage" | "stage">;

/** Where a case is on the tracker (0 to 4), or -1 when it was cancelled. Work at the lab is Production unless its stage text says Trial or Final. */
export function stageIndex(order: Shape): number {
  switch (order.pipeline_stage) {
    case "cancelled":
      return -1;
    case "to_send":
      return 0;
    case "ready_to_fit":
    case "rework":
      return 3;
    case "fitted":
      return 4;
    default: {
      const text = order.stage?.toLowerCase() ?? "";
      if (/final|finish|glaz/.test(text)) return 3;
      if (/trial|try|bisque/.test(text)) return 2;
      return 1;
    }
  }
}

export const PIPELINE_LABEL: Readonly<Record<LabOrder["pipeline_stage"], string>> = {
  to_send: "Not sent yet",
  sent: "Sent to lab",
  in_progress: "At the lab",
  ready_to_fit: "Back, ready to fit",
  fitted: "Delivered",
  rework: "Sent back for rework",
  cancelled: "Cancelled",
};

/** One call to the API: a status move, or a change of stage text while the work stays at the lab. */
export type Move = { kind: "status"; status: LabOrder["status"]; stage?: string } | { kind: "stage"; stage: string };

/** The calls that take a case to `target` (1 to 4); empty when it can't go there (backwards, cancelled, already done). */
export function planMove(order: Shape, target: 1 | 2 | 3 | 4): Move[] {
  const now = stageIndex(order);
  if (now < 0 || order.status === "returned_for_rework" || target <= now) return [];
  const moves: Move[] = [];
  let status = order.status;
  if (status === "draft") {
    moves.push({ kind: "status", status: "sent" });
    status = "sent";
  }
  if (target === 4) {
    if (status === "sent" || status === "in_progress") moves.push({ kind: "status", status: "received", stage: "Final" });
    moves.push({ kind: "status", status: "fitted", stage: "Delivered" });
    return moves;
  }
  if (status === "received") return [];
  const stage = STAGES[target];
  moves.push(status === "sent" ? { kind: "status", status: "in_progress", stage } : { kind: "stage", stage });
  return moves;
}

/** The step after this one, for the quick button on a card. */
export function nextStage(order: Shape): { target: 1 | 2 | 3 | 4; label: string } | null {
  const now = stageIndex(order);
  if (now < 0 || now >= 4 || order.status === "returned_for_rework") return null;
  const target = ([1, 2, 3, 4] as const)[now];
  return target === undefined || planMove(order, target).length === 0 ? null : { target, label: STAGES[target] };
}

export const WORK_TYPES = [
  "Zirconia crown",
  "PFM crown",
  "E-max crown",
  "Implant crown",
  "Custom abutment",
  "Bridge (3 unit)",
  "Complete denture",
  "Partial denture",
  "Retainer",
  "Night guard",
  "Aligners",
  "Veneer",
  "CBCT scan",
] as const;

/** `36, 37` or `36 37` into tooth numbers; null when something isn't a tooth number. */
export function parseTeeth(text: string): number[] | null {
  const parts = text.split(/[\s,]+/).filter((p) => p !== "");
  const teeth = parts.map(Number);
  return teeth.every((t) => Number.isInteger(t) && t >= 11 && t <= 85) ? teeth : null;
}

/** A WhatsApp link for a phone number and a message. */
export function waLink(phone: string, text: string): string {
  return `https://wa.me/${phone.replace(/\D/g, "")}?text=${encodeURIComponent(text)}`;
}

/** `tel:` for a phone number, dropping spaces and brackets. */
export const telLink = (phone: string): string => `tel:${phone.replace(/[^\d+]/g, "")}`;

/** What a reminder says about the work: kind, teeth, shade and the due date, never the patient. */
export function reminderText(order: Pick<LabOrder, "number" | "items" | "due_on" | "contact_name">, clinicName: string): string {
  const work = order.items
    .map((item) => {
      const detail = [item.teeth.length > 0 ? `tooth ${item.teeth.join(", ")}` : null, item.shade == null ? null : `shade ${item.shade}`].filter((part) => part !== null).join(", ");
      return `${item.work_type}${detail === "" ? "" : ` (${detail})`}`;
    })
    .join(", ");
  return `Hi ${order.contact_name ?? "team"}, reminder from ${clinicName}: order ${order.number} - ${work}${order.due_on == null ? "" : `, due ${order.due_on}`}. Please confirm dispatch.`;
}
