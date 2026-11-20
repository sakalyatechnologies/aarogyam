// Show patient's X-rays tab (§1.12): Explain mode's image viewer, pins, chart and summary, plus an
// upload for a new OPG or X-ray. Lazy: the Teeth tab never loads it.
import { ImagePlus } from "lucide-react";
import { useState } from "react";

import type { PatientId, VisitId } from "@aarogyam/api-client";

import { ExplainBody } from "../../patients/v2/explain/explain-mode.js";
import { UploadDialog } from "../../patients/v2/images.js";

export function XraysTab({ patientId, visitId, imageId }: { patientId: PatientId; visitId: VisitId; imageId: string | undefined }) {
  const [uploading, setUploading] = useState(false);
  return (
    <div className="odo pm-xrays">
      <div className="pm-xr-bar">
        <button type="button" className="pm-chip" onClick={() => { setUploading(true); }}>
          <ImagePlus aria-hidden="true" />
          Add X-ray or OPG
        </button>
      </div>
      <ExplainBody patientId={patientId} imageId={imageId} />
      {uploading ? <UploadDialog patientId={patientId} visitId={visitId} initialTag="OPG" onClose={() => { setUploading(false); }} /> : null}
    </div>
  );
}
