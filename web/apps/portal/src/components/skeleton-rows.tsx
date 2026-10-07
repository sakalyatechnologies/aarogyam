import { Skeleton } from "./mk/kit.js";

/**
 * Placeholder rows shown while a page's first load is pending, in the V4 shimmer. One status region
 * announces the wait; the shapes themselves are hidden from screen readers.
 */
export function SkeletonRows({ count = 4, label = "Loading", tall = false }: { count?: number; label?: string; tall?: boolean }) {
  return (
    <div role="status" aria-label={label} className="flex flex-col gap-3">
      {Array.from({ length: count }, (_, index) => (
        <Skeleton key={index} shape={tall ? "row" : "line"} style={tall ? undefined : { height: 36, borderRadius: 12 }} />
      ))}
    </div>
  );
}
