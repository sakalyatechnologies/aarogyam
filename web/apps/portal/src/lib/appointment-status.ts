import type { AppointmentStatus } from "@aarogyam/api-client";

import type { ChipTone } from "../components/mk/kit.js";

/** V4 status chips for an appointment: In chair green, Waiting amber, Confirmed blue, Done grey, No-show red. */
export const APPOINTMENT_CHIP: Readonly<Record<AppointmentStatus, { tone: ChipTone; label: string }>> = {
  requested: { tone: "waiting", label: "Requested" },
  booked: { tone: "brand", label: "Booked" },
  confirmed: { tone: "confirmed", label: "Confirmed" },
  arrived: { tone: "waiting", label: "Waiting" },
  in_chair: { tone: "ready", label: "In chair" },
  completed: { tone: "done", label: "Done" },
  no_show: { tone: "noshow", label: "No-show" },
  cancelled: { tone: "done", label: "Cancelled" },
};
