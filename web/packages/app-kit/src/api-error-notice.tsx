import { apiErrorOf } from "@aarogyam/api-client";
import { ErrorState } from "@sakalya/ui";

export interface ApiErrorNoticeProps {
  /** What failed, in the user's words, such as "Couldn't load clinics". */
  title: string;
  /** The thrown value from a query or mutation. */
  error: unknown;
  onRetry?: () => void;
  className?: string;
}

/**
 * A failed request, explained: the API's safe message and the request ID to quote to support
 * (`sk request <id>` finds every log line for it). Never shows raw error text.
 */
export function ApiErrorNotice({ title, error, onRetry, className }: ApiErrorNoticeProps) {
  const apiError = apiErrorOf(error);
  return (
    <ErrorState
      title={title}
      description={apiError?.message ?? "Something went wrong. Please try again."}
      requestId={apiError?.requestId}
      requestIdLabel="Reference"
      {...(onRetry === undefined ? {} : { onRetry })}
      {...(className === undefined ? {} : { className })}
    />
  );
}
