import { Play } from "lucide-react";
import { useEffect, useState } from "react";

import { apiErrorOf, unwrap, type Attachment } from "@aarogyam/api-client";
import { formatDateTime } from "@aarogyam/app-kit";
import { Button } from "@sakalya/ui";

import { useClinic } from "../../../clinic.js";
import { DICTATION_LANGUAGES, clock } from "./dictation.js";

/**
 * Plays one kept recording. The audio is fetched only when asked for, through a five minute signed link that
 * the API writes to the access record; it is played from memory, so the link never stays in the page.
 */
export function RecordingPlayer({ recording }: { recording: Attachment }) {
  const { api } = useClinic();
  const [url, setUrl] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  useEffect(
    () => () => {
      if (url !== undefined) {
        URL.revokeObjectURL(url);
      }
    },
    [url],
  );

  const load = () => {
    setLoading(true);
    setError(undefined);
    unwrap(api.getDownloadLink(recording.id))
      .then(async (link) => {
        const response = await fetch(link.url);
        if (!response.ok) {
          throw new Error("The recording could not be opened.");
        }
        setUrl(URL.createObjectURL(await response.blob()));
      })
      .catch((thrown: unknown) => {
        setError(apiErrorOf(thrown)?.message ?? "Couldn't open that recording. Please try again.");
      })
      .finally(() => {
        setLoading(false);
      });
  };

  const language = DICTATION_LANGUAGES.find((entry) => entry.value === recording.language)?.label;
  return (
    <li className="flex flex-col gap-2 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-text">
          Voice recording
          {recording.duration_seconds == null ? "" : ` · ${clock(recording.duration_seconds)}`}
          {language === undefined ? "" : ` · ${language}`}
        </span>
        <span className="text-xs text-muted">{formatDateTime(recording.created_at)}</span>
        {url === undefined ? (
          <Button variant="secondary" icon={<Play aria-hidden="true" className="size-4" />} disabled={loading} onClick={load}>
            {loading ? "Opening…" : "Play"}
          </Button>
        ) : null}
      </div>
      {url === undefined ? null : <audio controls autoPlay src={url} aria-label="Voice recording" className="w-full" />}
      {error === undefined ? null : (
        <p role="alert" className="text-xs font-medium text-danger-text">
          {error}
        </p>
      )}
    </li>
  );
}
