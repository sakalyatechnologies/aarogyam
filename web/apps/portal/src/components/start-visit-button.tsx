import { Stethoscope } from "lucide-react";
import { useNavigate } from "react-router";

import { apiErrorOf, type QueueTokenId } from "@aarogyam/api-client";
import { Button, useToast } from "@sakalya/ui";

import { useClinic } from "../clinic.js";
import { patientPath } from "../lib/patients.js";
import { useStartVisitFromQueue } from "../walk-in-queries.js";

/**
 * One tap for the doctor: seats the patient, opens (or reopens) their visit and goes there.
 * Shown only to people who write clinical notes.
 */
export function StartVisitButton({ tokenId, variant = "primary", label = "Start visit" }: { tokenId: QueueTokenId; variant?: "primary" | "secondary"; label?: string }) {
  const { can } = useClinic();
  const start = useStartVisitFromQueue();
  const navigate = useNavigate();
  const toast = useToast();
  if (!can("clinical.write")) {
    return null;
  }
  return (
    <Button
      variant={variant}
      icon={<Stethoscope aria-hidden="true" className="size-4" />}
      disabled={start.isPending}
      onClick={() => {
        start.mutate(tokenId, {
          onSuccess: ({ visit }) => {
            void navigate(`${patientPath({ id: visit.patient_id })}/visits/${encodeURIComponent(visit.id)}`);
          },
          onError: (thrown) => {
            toast.show({ title: apiErrorOf(thrown)?.message ?? "Couldn't start the visit.", tone: "danger" });
          },
        });
      }}
    >
      {start.isPending ? "Opening…" : label}
    </Button>
  );
}
