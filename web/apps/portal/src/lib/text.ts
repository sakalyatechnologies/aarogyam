/** Joins what is filled in with " · ", so an empty timing or duration leaves no dangling dot. */
export function joinParts(parts: readonly (string | null | undefined)[]): string {
  return parts.filter((part): part is string => part != null && part.trim() !== "").join(" · ");
}
