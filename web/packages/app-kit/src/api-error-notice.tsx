import { AlertTriangle, RotateCw } from "lucide-react";

import { apiErrorOf } from "@aarogyam/api-client";
import { Button, EmptyState } from "@sakalya/ui";

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
  const message = apiError?.message ?? "Something went wrong. Please try again.";
  return (
    <div role="alert" className={className}>
      <EmptyState
        title={title}
        description={message}
        icon={<AlertTriangle className="size-7" />}
        action={
          <div className="flex flex-col items-center gap-3">
            {onRetry === undefined ? null : (
              <Button variant="secondary" icon={<RotateCw aria-hidden="true" className="size-4" />} onClick={onRetry}>
                Try again
              </Button>
            )}
            {apiError?.requestId === undefined ? null : (
              <p className="text-xs text-muted">
                Reference <span className="font-mono select-all">{apiError.requestId}</span>
              </p>
            )}
          </div>
        }
      />
    </div>
  );
}
