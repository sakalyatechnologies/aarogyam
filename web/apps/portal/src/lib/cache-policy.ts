/**
 * How long each kind of data may be reused before react-query asks the API again. Reference data
 * (settings, branding, letterhead, price list, staff, roles) changes rarely and only through our
 * own mutations, which invalidate it, so it lives for minutes. Schedules and queues change under us
 * (other staff, patients arriving), so they go stale fast and refetch when the tab regains focus.
 */
const MINUTE = 60_000;

export interface CachePolicy {
  readonly staleTime: number;
  readonly gcTime: number;
  readonly refetchOnWindowFocus: boolean;
}

/** Settings, branding, price list, staff, rooms, doctors. */
export const REFERENCE: CachePolicy = { staleTime: 5 * MINUTE, gcTime: 30 * MINUTE, refetchOnWindowFocus: false };

/** Roles and what they allow: almost never change. */
export const ROLES: CachePolicy = { staleTime: 15 * MINUTE, gcTime: 60 * MINUTE, refetchOnWindowFocus: false };

/**
 * The letterhead carries signed image links that last an hour, so it is refreshed well before
 * they lapse (a stale link is a broken logo).
 */
export const LETTERHEAD: CachePolicy = { staleTime: 10 * MINUTE, gcTime: 30 * MINUTE, refetchOnWindowFocus: false };

/** Today, queues, calendars: live data. */
export const SCHEDULE: CachePolicy = { staleTime: 15_000, gcTime: 5 * MINUTE, refetchOnWindowFocus: true };
