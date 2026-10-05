import type { ClinicStatus } from "@aarogyam/api-client";
import type { Tone } from "@sakalya/ui";

import { StatusChip } from "../../ui/status-chip.js";

export const CLINIC_STATUS: Readonly<Record<ClinicStatus, { label: string; tone: Tone }>> = {
  trial: { label: "Trial", tone: "info" },
  active: { label: "Active", tone: "success" },
  suspended: { label: "Suspended", tone: "warning" },
  churned: { label: "Churned", tone: "neutral" },
};

export function ClinicStatusPill({ status }: { status: ClinicStatus }) {
  return <StatusChip tone={CLINIC_STATUS[status].tone}>{CLINIC_STATUS[status].label}</StatusChip>;
}
