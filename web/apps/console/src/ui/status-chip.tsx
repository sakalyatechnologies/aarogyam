import { CheckCircle2, CircleDot, Clock3, XCircle } from "lucide-react";

import { Pill, type Tone } from "@sakalya/ui";

const ICONS: Readonly<Record<Tone, typeof CheckCircle2>> = {
  success: CheckCircle2,
  warning: Clock3,
  danger: XCircle,
  info: CircleDot,
  neutral: CircleDot,
  primary: CircleDot,
};

/** A status as colour, icon and words together, so no state is shown by colour alone. */
export function StatusChip({ tone, children }: { tone: Tone; children: string }) {
  const Icon = ICONS[tone];
  return (
    <Pill tone={tone} icon={<Icon aria-hidden="true" className="size-3.5" />}>
      {children}
    </Pill>
  );
}
