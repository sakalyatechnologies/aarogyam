import { Skeleton } from "@sakalya/ui";

/**
 * Placeholder rows shown while a page's first load is pending. One status region announces the
 * wait; the shapes themselves are hidden from screen readers.
 */
export function SkeletonRows({ count = 4, label = "Loading", tall = false }: { count?: number; label?: string; tall?: boolean }) {
  return (
    <div role="status" aria-label={label} className="flex flex-col gap-3">
      {Array.from({ length: count }, (_, index) => (
        <Skeleton key={index} shape={tall ? "block" : "line"} className={tall ? "h-16" : "h-9"} />
      ))}
    </div>
  );
}
