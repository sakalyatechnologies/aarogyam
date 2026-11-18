import { formatDate } from "@aarogyam/app-kit";

import { countLabel, progress } from "./model.js";

/** "Since you joined (12 Mar 2026): 6 teeth treated here — 3 fillings, 1 root canal. Before: 4 teeth with work from elsewhere." Hidden when there is nothing to say. */
export function ProgressLine({ history, procedures, since }: { history: Parameters<typeof progress>[0]; procedures: Parameters<typeof progress>[1]; since: string | undefined }) {
  const counted = progress(history, procedures);
  if (counted.here === 0 && counted.before === 0 && counted.byTreatment.length === 0) return null;
  const teeth = (n: number) => `${String(n)} ${n === 1 ? "tooth" : "teeth"}`;
  const work = counted.byTreatment.map(countLabel).join(", ");
  return (
    <p className="tc-progress" aria-label="Progress">
      {counted.here > 0 || work !== "" ? (
        <>
          <strong>{since === undefined ? "At this clinic" : `Since you joined (${formatDate(since)})`}</strong>
          {`: ${teeth(counted.here)} treated here${work === "" ? "" : ` — ${work}`}.`}
        </>
      ) : null}
      {counted.before > 0 ? (
        <>
          {" "}
          <strong>Before:</strong>
          {` ${teeth(counted.before)} with work from elsewhere.`}
        </>
      ) : null}
    </p>
  );
}
