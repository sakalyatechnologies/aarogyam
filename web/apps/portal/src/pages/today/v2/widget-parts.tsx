import type { UseQueryResult } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { ApiErrorNotice } from "@aarogyam/app-kit";
import { BentoCard, EmptyState, Skeleton } from "@sakalya/ui";

/** The card every widget sits in. The Board's card style and density restyle `.tv2-card` from outside. */
export function WidgetCard({ title, subtitle, action, children }: { title: string; subtitle?: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <BentoCard title={title} subtitle={subtitle} action={action} className="tv2-card">
      {children}
    </BentoCard>
  );
}

export function Loading({ label, rows = 3 }: { label: string; rows?: number }) {
  return (
    <div role="status" aria-label={`Loading ${label}`} className="tv2-loading">
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} shape="line" className={index === 0 ? "h-6 w-2/3" : "h-4 w-full"} />
      ))}
    </div>
  );
}

export function Empty({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return <EmptyState icon={null} title={title} description={description} action={action} className="py-6" />;
}

/**
 * A widget's three states around its data: loading skeleton, the error with a retry, and an empty message when there is
 * nothing to show. `children` runs only with data.
 */
export function Body<T>({ query, label, rows, isEmpty, empty, children }: { query: UseQueryResult<T>; label: string; rows?: number; isEmpty?: (data: T) => boolean; empty: ReactNode; children: (data: T) => ReactNode }) {
  if (query.isPending) return <Loading label={label} {...(rows === undefined ? {} : { rows })} />;
  if (query.isError) {
    return (
      <ApiErrorNotice
        title={`Couldn't load ${label}`}
        error={query.error}
        onRetry={() => {
          void query.refetch();
        }}
      />
    );
  }
  if (isEmpty?.(query.data) === true) return <>{empty}</>;
  return <>{children(query.data)}</>;
}
