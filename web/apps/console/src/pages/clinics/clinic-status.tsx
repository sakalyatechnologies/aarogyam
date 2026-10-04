import type { ClinicStatus } from "@aarogyam/api-client";
import { Pill, type Tone } from "@sakalya/ui";

const STATUS: Readonly<Record<ClinicStatus, { label: string; tone: Tone }>> = {
  trial: { label: "Trial", tone: "info" },
  active: { label: "Active", tone: "success" },
  suspended: { label: "Suspended", tone: "warning" },
  churned: { label: "Churned", tone: "neutral" },
};

export function ClinicStatusPill({ status }: { status: ClinicStatus }) {
  return <Pill tone={STATUS[status].tone}>{STATUS[status].label}</Pill>;
}
