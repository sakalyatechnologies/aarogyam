import { useEffect, useRef, useState } from "react";

import { useQueryClient } from "@tanstack/react-query";

import { useClinic } from "../clinic.js";
import { initials } from "../components/mk/index.js";
import { useLetterhead } from "../queries.js";

/**
 * The clinic's logo in the sidebar, or its initials when there is none or it fails to load. The
 * logo link is signed and expires, so a failed load refreshes the letterhead once to get a new one.
 */
export function ClinicMark({ name }: { name: string }) {
  const { can, access } = useClinic();
  const queryClient = useQueryClient();
  // The letterhead (and so the logo link) is for people who can read patients; others see initials.
  const letterhead = useLetterhead(can("patients.read"));
  const url = letterhead.data?.logo_url ?? undefined;
  const [failed, setFailed] = useState<string | undefined>(undefined);
  const refreshed = useRef(false);
  useEffect(() => {
    refreshed.current = false;
  }, [access.org_id]);
  const showLogo = url !== undefined && url !== "" && failed !== url;
  return (
    <div className={`mk-logo-mark ${showLogo ? "has-img" : ""}`} aria-hidden="true">
      {showLogo ? (
        <img
          src={url}
          alt=""
          onError={() => {
            setFailed(url);
            if (!refreshed.current) {
              refreshed.current = true;
              void queryClient.invalidateQueries({ queryKey: ["letterhead", access.org_id] });
            }
          }}
        />
      ) : (
        initials(name)
      )}
    </div>
  );
}
