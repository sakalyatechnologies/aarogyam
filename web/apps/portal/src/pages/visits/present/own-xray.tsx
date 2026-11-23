// Show patient's Own X-ray style (present-studio-design §6.3, slice 1e): the patient's own radiograph,
// never flipped, with the visit's recorded findings beside it. The doctor's pins are Explain mode's,
// saved per image (slice 2g). Lives in the portal because it needs the attachments and signed links.
import { useEffect, useState } from "react";

import type { Attachment, PatientId, VisitId } from "@aarogyam/api-client";
import { formatDate } from "@aarogyam/app-kit";
import { XrayStyle, XrayView, type PresentModel, type XrayProps } from "@aarogyam/app-kit/present";

import { useOwnXrays } from "./own-xray-pick.js";
import { useAttachmentLink } from "../../patients/v2/attachment-link.js";
import { ImagePane, type PendingPin } from "../../patients/v2/explain/explain-mode.js";
import { useSavedPins } from "../../patients/v2/explain/use-saved-pins.js";
import { isFdi } from "../../patients/v2/explain/explain-model.js";

const captionOf = (image: Attachment, visitId: VisitId | undefined) =>
  `${image.label ?? "X-ray"}${image.visit_id === visitId ? " from today's visit" : ` from ${formatDate(image.created_at)}`}`;

/** The story card's picture: the first X-ray, plain (no pins), with its edge labels. */
export function StoryXray({ patientId, visitId }: { patientId: PatientId; visitId: VisitId }) {
  const { images } = useOwnXrays(patientId, visitId);
  const image = images[0];
  const link = useAttachmentLink(image);
  if (image === undefined) return null;
  return <XrayView src={link.data?.url} alt={captionOf(image, visitId)} caption={captionOf(image, visitId)} />;
}

interface SlotProps { model: PresentModel; patientId: PatientId; visitId: VisitId; load3d?: XrayProps["load3d"] }

export function OwnXraySlot({ model, patientId, visitId, load3d }: SlotProps) {
  const { images, loading } = useOwnXrays(patientId, visitId);
  const [chosenId, setChosenId] = useState<string | undefined>(undefined);
  const image = images.find((f) => f.id === chosenId) ?? images[0];
  const saved = useSavedPins(image?.id);
  const [pending, setPending] = useState<PendingPin | undefined>(undefined);
  const [active, setActive] = useState<number | undefined>(undefined);
  // Esc closes the pin picker first, before Present sees it
  useEffect(() => {
    if (pending === undefined) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      setPending(undefined);
    };
    window.addEventListener("keydown", onKey, true);
    return () => { window.removeEventListener("keydown", onKey, true); };
  }, [pending]);
  const place = (pin: PendingPin, tooth: number) => {
    if (image === undefined || !isFdi(tooth)) return;
    saved.place({ x: pin.x, y: pin.y, tooth, label: pin.label.trim() });
    setPending(undefined);
    setActive(tooth);
  };
  const stage = (
    <figure className="ps-xr-fig odo">
      <ImagePane
        edges
        images={images}
        image={image}
        loading={loading}
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
        onPlace={place}
        onClear={saved.clear}
      />
      {image === undefined ? null : <figcaption className="ps-muted">{captionOf(image, visitId)}</figcaption>}
    </figure>
  );
  return <XrayStyle model={model} stage={stage} load3d={load3d} />;
}
