import type { AddressStatus } from "@aarogyam/api-client";
import type { Tone } from "@sakalya/ui";

import { StatusChip } from "../../ui/status-chip.js";

/** How a clinic's portal address shows: words, tone and what it means for the clinic. */
export const ADDRESS_STATUS: Readonly<Record<AddressStatus, { label: string; tone: Tone; meaning: string }>> = {
  ready: { label: "Address ready", tone: "success", meaning: "The portal opens at this address; the owner can sign in." },
  pending: {
    label: "Address pending",
    tone: "warning",
    meaning: "Being set up automatically, usually within two minutes. Sign-in works there once it is ready.",
  },
  failed: {
    label: "Address failed",
    tone: "danger",
    meaning: "Setting up the address failed. Fix the cause, then run scripts/provision-hosts.sh to try again.",
  },
};

export function AddressStatusPill({ status }: { status: AddressStatus }) {
  if (status === "pending") {
    return (
      <span className="inline-flex items-center gap-1.5">
        <StatusChip tone={ADDRESS_STATUS[status].tone}>{ADDRESS_STATUS[status].label}</StatusChip>
        <span className="size-3 animate-spin rounded-full border-2 border-warning border-b-transparent" aria-label="Checking address status" />
      </span>
    );
  }
  return <StatusChip tone={ADDRESS_STATUS[status].tone}>{ADDRESS_STATUS[status].label}</StatusChip>;
}
