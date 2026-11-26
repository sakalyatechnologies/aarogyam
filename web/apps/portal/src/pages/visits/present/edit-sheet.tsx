/**
 * Edit a tooth without leaving Show patient: the chart's own tooth panel (history, Quick plan chips, the Why row, the forms) in a
 * side sheet over the patient's view, plus Add photo. It loads only when Edit is pressed. Every save already refreshes the mouth
 * and present queries, so the patient's view behind the sheet updates in place.
 */
import { Camera } from "lucide-react";
import { useRef } from "react";

import { apiErrorOf, type PatientId, type VisitId } from "@aarogyam/api-client";
import { Button, Drawer, useToast } from "@sakalya/ui";

import { useClinic } from "../../../clinic.js";
import { useDentalChart, useProcedures, useStaff, useUploadAttachment } from "../../../queries.js";
import { ToothPanel } from "../../patients/v2/tooth-chart/tooth-panel.js";
import { usePlans } from "../../treatment-plans/queries.js";

interface Props { patientId: PatientId; visitId: VisitId; tooth: number; onClose: () => void }

export function EditSheet({ patientId, visitId, tooth, onClose }: Props) {
  const { can } = useClinic();
  const chart = useDentalChart(patientId);
  const plans = usePlans(patientId);
  const procedures = useProcedures(can("clinical.read") ? patientId : undefined);
  const staff = useStaff(can("staff.manage"));
  const members = staff.data?.members ?? [];
  const planItems = plans.data?.items.flatMap((plan) => plan.items) ?? [];
  const statuses = chart.data?.statuses ?? [];
  return (
    <Drawer open onOpenChange={(open) => { if (!open) onClose(); }} title={`Edit tooth ${String(tooth)}`} size="lg">
      <div className="flex flex-col gap-4" data-edit-sheet={tooth}>
        <AddPhoto patientId={patientId} visitId={visitId} tooth={tooth} />
        {chart.data === undefined ? (
          <p role="status">Loading the chart…</p>
        ) : (
          <ToothPanel
            patientId={patientId}
            tooth={tooth}
            visitId={visitId}
            canWrite={can("clinical.write")}
            terms={chart.data.terms}
            planItems={planItems}
            procedures={procedures.data?.items ?? []}
            who={(id) => (id == null ? undefined : members.find((m) => m.id === id)?.display_name)}
            onClose={onClose}
            entries={chart.data.current.filter((e) => e.tooth === tooth)}
            status={statuses.find((s) => s.tooth === tooth)}
            condition={chart.data.conditions?.find((c) => c.tooth === tooth)}
            eruption={chart.data.eruptions?.find((e) => e.tooth === tooth)}
          />
        )}
      </div>
    </Drawer>
  );
}

/** A photo of the tooth: the camera on a phone. Kept with this visit and tagged to the tooth. */
function AddPhoto({ patientId, visitId, tooth }: { patientId: PatientId; visitId: VisitId; tooth: number }) {
  const input = useRef<HTMLInputElement>(null);
  const upload = useUploadAttachment(patientId);
  const toast = useToast();
  const send = (file: File) => {
    const form = new FormData();
    form.set("file", file);
    form.set("kind", "photo");
    form.set("label", "Intraoral");
    form.set("tooth", String(tooth));
    form.set("visit_id", visitId);
    form.set("caption", `Tooth ${String(tooth)}`);
    upload.mutate(form, {
      onSuccess: () => { toast.show({ title: `Photo of tooth ${String(tooth)} added`, tone: "success" }); },
      onError: (thrown) => { toast.show({ title: apiErrorOf(thrown)?.message ?? "Couldn't add the photo. Please try again.", tone: "danger" }); },
    });
  };
  return (
    <div>
      <input
        ref={input}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        aria-label="Photo of the tooth"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file !== undefined) send(file);
        }}
      />
      <Button variant="secondary" disabled={upload.isPending} onClick={() => { input.current?.click(); }}>
        <Camera aria-hidden="true" className="size-4" />
        {upload.isPending ? "Adding…" : "Add photo"}
      </Button>
    </div>
  );
}
