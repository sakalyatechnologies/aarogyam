// Show patient's X-rays tab (§1.12): the image viewer with the doctor's pins and the list of what is pinned, plus an
// upload for a new OPG or X-ray. Patient-safe: no health counts and no doctor chart (those stay in Explain mode).
// Lazy: the Teeth tab never loads it.
import { ImagePlus } from "lucide-react";
import { useMemo, useState } from "react";

import type { PatientId, VisitId } from "@aarogyam/api-client";

import { useAttachments } from "../../../queries.js";
import { ImagePane, type PendingPin } from "../../patients/v2/explain/explain-mode.js";
import { explainImages, isFdi } from "../../patients/v2/explain/explain-model.js";
import { useSavedPins } from "../../patients/v2/explain/use-saved-pins.js";
import { UploadDialog } from "../../patients/v2/images.js";
import { toothName } from "../../patients/v2/tooth-chart/model.js";

export function XraysTab({ patientId, visitId, imageId }: { patientId: PatientId; visitId: VisitId; imageId: string | undefined }) {
  const [uploading, setUploading] = useState(false);
  const attachments = useAttachments(patientId);
  const images = useMemo(() => explainImages(attachments.data?.items ?? []), [attachments.data]);
  const [chosenId, setChosenId] = useState<string | undefined>(imageId);
  const image = images.find((f) => f.id === chosenId) ?? images[0];
  const saved = useSavedPins(image?.id);
  const [pending, setPending] = useState<PendingPin | undefined>(undefined);
  const [active, setActive] = useState<number | undefined>(undefined);
  return (
    <div className="odo pm-xrays">
      <div className="pm-xr-bar">
        <button type="button" className="pm-chip" onClick={() => { setUploading(true); }}>
          <ImagePlus aria-hidden="true" />
          Add X-ray or OPG
        </button>
      </div>
      <ImagePane
        edges
        images={images}
        image={image}
        loading={attachments.isPending}
        pins={saved.pins}
        saveFailed={saved.failed}
        onRetrySave={saved.retry}
        pending={pending}
        active={active}
        onChoose={(file) => { setChosenId(file.id); setPending(undefined); }}
        onDrop={(x, y) => { setPending({ x, y, digits: "", label: "" }); }}
        onPin={(pin) => { setActive((before) => (before === pin.tooth ? undefined : pin.tooth)); }}
        onHoverPin={() => undefined}
        onPending={setPending}
        onPlace={(pin, tooth) => {
          if (!isFdi(tooth)) return;
          saved.place({ x: pin.x, y: pin.y, tooth, label: pin.label.trim() });
          setPending(undefined);
          setActive(tooth);
        }}
        onClear={saved.clear}
      />
      {saved.pins.length === 0 ? null : (
        <section className="pm-pinned-list" aria-label="Pinned findings">
          <h3>Pinned on this image</h3>
          <ol>
            {saved.pins.map((p) => (
              <li key={p.id} data-active={p.tooth === active || undefined}>
                {`Tooth ${String(p.tooth)}: ${toothName(p.tooth)}${p.label === "" ? "" : ` · ${p.label}`}`}
              </li>
            ))}
          </ol>
        </section>
      )}
      {uploading ? <UploadDialog patientId={patientId} visitId={visitId} initialTag="OPG" onClose={() => { setUploading(false); }} /> : null}
    </div>
  );
}
