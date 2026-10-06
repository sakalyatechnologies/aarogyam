// Aarogyam-owned. Where a signed-in person goes next.
import type { Me, MyClinic } from "./api";

export type Destination =
  | { kind: "console"; url: string }
  | { kind: "clinic"; clinic: MyClinic & { host: string } }
  | { kind: "picker"; clinics: (MyClinic & { host: string })[] }
  | { kind: "none" };

export function decideDestination(me: Me, consoleUrl: string): Destination {
  if (me.console_access === true && consoleUrl !== "") return { kind: "console", url: consoleUrl };
  const clinics = me.clinics.filter((c): c is MyClinic & { host: string } => typeof c.host === "string" && c.host !== "");
  if (clinics.length === 1 && clinics[0] !== undefined) return { kind: "clinic", clinic: clinics[0] };
  if (clinics.length > 1) return { kind: "picker", clinics };
  return { kind: "none" };
}
