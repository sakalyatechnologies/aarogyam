// The 3D smile in MouthView's overview slot (present-studio-design §6.4): gate first, then the lazy three.js
// chunk. Any failure (gate, `webglunavailable`, a slow probe, a chunk error) renders the painted style with the
// inline line; the chunk failing to load is the painted slot's own text fallback.
import { useMemo, useState, type ComponentProps, type ReactNode } from "react";

import { StyleBoundary } from "./blocks.js";
import { PaintedSlot } from "./painted-slot.js";
import { SMILE3D_FALLBACK_LINE, readDeviceEnv, smile3dAllowed, type DeviceEnv } from "./smile3d-gate.js";
import { useChunk } from "./blocks.js";

const loadSmile3d = () => import("./smile3d.js").then((m) => m.smile3dStyle);

type PaintedSlotProps = ComponentProps<typeof PaintedSlot>;

export function Smile3dSlot({ env, ...props }: PaintedSlotProps & { env?: DeviceEnv | undefined }): ReactNode {
  const device = useMemo(() => env ?? readDeviceEnv(), [env]);
  const [failed, setFailed] = useState(false);
  const allowed = smile3dAllowed(device);
  if (!allowed || failed) {
    return (
      <>
        <p className="ps-note" role="status" data-testid="smile3d-fallback">{SMILE3D_FALLBACK_LINE}</p>
        <PaintedSlot {...props} />
      </>
    );
  }
  return <Mounted {...props} onFail={() => { setFailed(true); }} />;
}

function Mounted({ onFail, ...props }: PaintedSlotProps & { onFail: () => void }): ReactNode {
  const chunk = useChunk(loadSmile3d);
  if (chunk.state === "failed") { queueMicrotask(onFail); return null; }
  if (chunk.value === undefined) return <div className="ps-wait" role="status" aria-label="Loading the 3D smile" />;
  const Smile = chunk.value.Component;
  return (
    <StyleBoundary fallback={<Failing onFail={onFail} />}>
      <Smile
        model={props.model} orientation={props.orientation} onOrientation={props.onOrientation} theme={props.theme}
        onOpen={props.slot.open} onFail={onFail} load3d={props.load3d}
      />
    </StyleBoundary>
  );
}

function Failing({ onFail }: { onFail: () => void }): ReactNode {
  queueMicrotask(onFail);
  return null;
}
