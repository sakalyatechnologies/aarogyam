// Which chart treatments each Show patient option means (the studio's `plan_models`). Kept tiny: the Present route reads it
// before anything else loads. Only a one-to-one option can be chosen with "Go with this".
import type { TreatmentKey } from "../../patients/v2/tooth-chart/model.js";

export const OPTION_TREATMENTS: Readonly<Record<string, readonly TreatmentKey[]>> = {
  rct_crown: ["root_canal", "crown"],
  extract_implant: ["implant"],
  extract_bridge: ["bridge"],
  extract: ["extraction"],
  implant: ["implant"],
  bridge: ["bridge"],
  remove: ["extraction"],
};

export const singleTreatment = (option: string): TreatmentKey | undefined => {
  const keys = OPTION_TREATMENTS[option];
  return keys?.length === 1 ? keys[0] : undefined;
};
