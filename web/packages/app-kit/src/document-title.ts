import { useEffect } from "react";

/**
 * Sets the browser tab title while a page is shown. Titles land in browser history (and
 * history sync), so they carry numbers and page names only, never a patient's name.
 */
export function useDocumentTitle(...parts: readonly (string | undefined)[]): void {
  const title = parts.filter((part) => part !== undefined && part !== "").join(" · ");
  useEffect(() => {
    const previous = document.title;
    document.title = title;
    return () => {
      document.title = previous;
    };
  }, [title]);
}
