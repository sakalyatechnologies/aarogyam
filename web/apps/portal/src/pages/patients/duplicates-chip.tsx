import { Link } from "react-router";

import { useClinic } from "../../clinic.js";
import { usePatientDuplicates } from "../../queries.js";

/** "n possible duplicates", linking to the review list; nothing while there are none or without `patients.read`. */
export function DuplicatesChip() {
  const { can } = useClinic();
  const allowed = can("patients.read");
  const count = usePatientDuplicates(allowed).data?.items.length ?? 0;
  if (!allowed || count === 0) {
    return null;
  }
  return (
    <Link to="/patients/duplicates" className="mk-btn mk-btn-ghost">
      {count === 1 ? "1 possible duplicate" : `${String(count)} possible duplicates`}
    </Link>
  );
}
