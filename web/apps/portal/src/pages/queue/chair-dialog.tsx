import { Armchair } from "lucide-react";

import type { Room, RoomId } from "@aarogyam/api-client";
import { Button, Dialog } from "@sakalya/ui";

/** "To chair" asks which chair: one tap on a chair seats the patient there (`room_id`). */
export function ChairDialog({
  patientName,
  rooms,
  busy,
  onPick,
  onClose,
}: {
  patientName: string | undefined;
  rooms: readonly Room[];
  busy: boolean;
  onPick: (roomId: RoomId) => void;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={patientName !== undefined}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Which chair?"
      description={patientName === undefined ? undefined : `Seat ${patientName} in a chair.`}
      size="sm"
      footer={
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
      }
    >
      {rooms.length === 0 ? (
        <p className="text-sm text-muted">No chairs are set up yet. Add them in Settings.</p>
      ) : (
        <div className="fd-chairs" role="group" aria-label="Chairs">
          {rooms.map((room) => (
            <button
              key={room.id}
              type="button"
              className="fd-chair"
              disabled={busy}
              onClick={() => {
                onPick(room.id);
              }}
            >
              <Armchair aria-hidden="true" className="size-5" />
              {room.name}
            </button>
          ))}
        </div>
      )}
    </Dialog>
  );
}
