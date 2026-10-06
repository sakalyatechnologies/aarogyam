import { Mic } from "lucide-react";
import { useState } from "react";
import { matchPath, useLocation, useNavigate } from "react-router";

import { apiErrorOf, unwrap, visitId as parseVisitId, type Patient } from "@aarogyam/api-client";
import { Button, Dialog, useToast } from "@sakalya/ui";

import { useClinic } from "../clinic.js";
import { PatientPicker } from "../components/patient-picker.js";
import { useVisit } from "../queries.js";

/**
 * The top bar's "Voice note". On an open visit it opens the recorder there; anywhere else it asks which patient,
 * then goes to that patient's open visit (starting a walk-in visit when there is none, as "Start visit" does).
 * The patient is chosen from a search box, so no name or number is ever put in the address.
 */
export function VoiceNoteButton() {
  const { can, api } = useClinic();
  const location = useLocation();
  const navigate = useNavigate();
  const toast = useToast();
  const [choosing, setChoosing] = useState(false);
  const [busy, setBusy] = useState(false);
  const matched = matchPath("/patients/:id/visits/:visitId", location.pathname);
  const current = parseVisitId.safeParse(matched?.params.visitId);
  const visit = useVisit(current.success ? current.data : undefined);
  const allowed = can("clinical.write");

  const onChoose = (patient: Patient) => {
    setBusy(true);
    unwrap(api.listVisits(patient.id))
      .then(async (visits) => {
        const open = visits.items.find((entry) => entry.status === "open") ?? (await unwrap(api.startVisit(patient.id, {})));
        setChoosing(false);
        void navigate(`/patients/${patient.id}/visits/${open.id}?voice=1`);
      })
      .catch((thrown: unknown) => {
        toast.show({ title: apiErrorOf(thrown)?.message ?? "Couldn't open a visit for that patient.", tone: "danger" });
      })
      .finally(() => {
        setBusy(false);
      });
  };

  return (
    <>
      <button
        type="button"
        className="mk-btn mk-btn-ghost mk-hide-sm"
        disabled={!allowed}
        title={allowed ? "Dictate a note and keep the recording" : "Your role can't write clinical notes"}
        onClick={() => {
          if (visit.data?.visit.status === "open") {
            void navigate(`${location.pathname}?voice=1`);
          } else {
            setChoosing(true);
          }
        }}
      >
        <Mic aria-hidden="true" /> Voice note
      </button>
      {choosing ? (
        <Dialog
          open
          onOpenChange={() => {
            setChoosing(false);
          }}
          title="Voice note: choose the patient"
          description="The note is saved as a draft on this patient's record."
          footer={
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => {
                setChoosing(false);
              }}
            >
              Cancel
            </Button>
          }
        >
          <PatientPicker onChoose={onChoose} />
        </Dialog>
      ) : null}
    </>
  );
}
