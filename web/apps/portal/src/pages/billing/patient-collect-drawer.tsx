import { formatDate, formatRupees } from "@aarogyam/app-kit";
import { Drawer } from "@sakalya/ui";

import type { PendingGroup } from "./billing-v2-parts.js";
import { CollectForm } from "./collect-form.js";

/**
 * Collect from one patient who owes on several bills: one payment for the amount entered, split oldest bill first. Stays
 * open after the last bill is settled, saying so, until closed.
 */
export function PatientCollectDrawer({ open, name, group, onClose }: { open: boolean; name: string; group: PendingGroup | undefined; onClose: () => void }) {
  const oldest = group?.bills[0];
  return (
    <Drawer
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={`Collect from ${name}`}
      description="One payment, settling the oldest bill first"
      size="md"
    >
      <div className="bl2-drawer">
        {group === undefined || oldest === undefined ? (
          <p className="bl2-sub" role="status">
            Nothing left to collect. Every bill is paid in full.
          </p>
        ) : (
          <>
            <p className="bl2-sub">
              {group.bills.length} bills · {formatRupees(group.owed_paise)} owed · oldest from {formatDate(oldest.issued_at ?? oldest.created_at)}
            </p>
            <CollectForm patientId={group.patient.id} bills={group.bills} />
          </>
        )}
      </div>
    </Drawer>
  );
}
