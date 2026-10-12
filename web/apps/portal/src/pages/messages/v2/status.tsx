import { Tag } from "../../../components/mk/index.js";

/** Why a message was skipped, in words for the front desk. */
export const SKIP_REASON: Record<string, string> = {
  no_consent: "No consent",
  consent_withdrawn: "Consent withdrawn",
  opted_out: "Opted out",
  no_address: "No email address",
  frequency_cap: "Too soon after the last one",
  quiet_hours: "Held for quiet hours",
};

const TONE: Record<string, "wait" | "done" | "down" | "neutral"> = { queued: "wait", sending: "wait", sent: "done", failed: "down", skipped: "neutral" };

/** A message's status as a tag: "Sent", "Queued", or "Skipped: No consent". */
export function StatusTag({ status, reason, delivery }: { status: string; reason?: string | null | undefined; delivery?: string | null | undefined }) {
  const tone = TONE[status] ?? "neutral";
  const word = status.charAt(0).toUpperCase() + status.slice(1);
  const why = status === "skipped" && reason != null ? `: ${SKIP_REASON[reason] ?? reason.replaceAll("_", " ")}` : "";
  const detail = status === "sent" && delivery != null && delivery !== "" ? ` · ${delivery}` : "";
  return <Tag tone={tone}>{`${word}${why}${detail}`}</Tag>;
}
