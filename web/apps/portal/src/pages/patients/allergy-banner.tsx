import { Check } from "lucide-react";

import { apiErrorOf, type Allergy, type PatientId } from "@aarogyam/api-client";
import { Button, useToast } from "@sakalya/ui";

import { AlertBanner } from "../../components/mk/index.js";
import { useClinic } from "../../clinic.js";
import { useClinicalFlags } from "../../queries.js";
import { useConfirmAllergy } from "../../walk-in-queries.js";
import "../../components/quick-picks.css";

/**
 * The allergy banner under the patient's header: every active allergy, so nobody prescribes past it. Allergies
 * the patient reported at the desk carry a "patient-reported" badge until a clinician confirms them (one click).
 * "No known allergies", once asked, shows too, so an empty list never reads as "never asked".
 */
export function AllergyBanner({ patientId }: { patientId: PatientId }) {
  const flags = useClinicalFlags(patientId);
  const { can } = useClinic();
  const data = flags.data;
  if (data === undefined) {
    return null;
  }
  if (data.allergy_count === 0) {
    return data.allergies_reviewed === "none_known" ? (
      <AlertBanner tone="info">
        <b>No known allergies</b> · as the patient told the desk
      </AlertBanner>
    ) : null;
  }
  const active = data.allergies.filter((allergy) => allergy.status === "active");
  if (data.details_hidden || active.length === 0) {
    return (
      <AlertBanner tone={data.severe_allergy ? "danger" : "warn"}>
        <b>{`${String(data.allergy_count)} recorded ${data.allergy_count === 1 ? "allergy" : "allergies"}`}</b> · check before prescribing
      </AlertBanner>
    );
  }
  const canConfirm = can("clinical.write");
  return (
    <AlertBanner tone={data.severe_allergy ? "danger" : "warn"}>
      <span className="mk-allergy-list">
        <b>Allergies:</b>
        {active.map((allergy) => (
          <AllergyChip key={allergy.id} patientId={patientId} allergy={allergy} canConfirm={canConfirm} />
        ))}
        <span>· check before prescribing</span>
      </span>
    </AlertBanner>
  );
}

function AllergyChip({ patientId, allergy, canConfirm }: { patientId: PatientId; allergy: Allergy; canConfirm: boolean }) {
  const confirm = useConfirmAllergy(patientId);
  const toast = useToast();
  return (
    <span className="mk-allergy-chip">
      <b>{allergy.substance}</b>
      {allergy.confirmed ? null : <span className="mk-allergy-reported">patient-reported</span>}
      {!allergy.confirmed && canConfirm ? (
        <Button
          variant="ghost"
          className="mk-allergy-confirm"
          aria-label={`Confirm allergy: ${allergy.substance}`}
          icon={<Check aria-hidden="true" className="size-3.5" />}
          disabled={confirm.isPending}
          onClick={() => {
            confirm.mutate(allergy.id, {
              onSuccess: () => {
                toast.show({ title: `${allergy.substance} allergy confirmed`, tone: "success" });
              },
              onError: (thrown) => {
                toast.show({ title: apiErrorOf(thrown)?.message ?? "Couldn't confirm that allergy.", tone: "danger" });
              },
            });
          }}
        >
          Confirm
        </Button>
      ) : null}
    </span>
  );
}
