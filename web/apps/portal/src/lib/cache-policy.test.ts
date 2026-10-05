import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import { LETTERHEAD, REFERENCE, ROLES, SCHEDULE } from "./cache-policy.js";

const MINUTE = 60_000;

describe("cache policy", () => {
  it("keeps reference data for minutes and does not refetch on focus", () => {
    for (const policy of [REFERENCE, ROLES, LETTERHEAD]) {
      expect(policy.staleTime).toBeGreaterThanOrEqual(MINUTE);
      expect(policy.gcTime).toBeGreaterThan(policy.staleTime);
      expect(policy.refetchOnWindowFocus).toBe(false);
    }
  });

  it("refreshes the letterhead before its signed image links (one hour) lapse", () => {
    expect(LETTERHEAD.staleTime).toBeLessThan(30 * MINUTE);
  });

  it("keeps schedules fresh to the second and refetches them on focus", () => {
    expect(SCHEDULE.staleTime).toBeLessThanOrEqual(30_000);
    expect(SCHEDULE.refetchOnWindowFocus).toBe(true);
  });

  it("serves reference data from cache and refetches it once invalidated", async () => {
    const client = new QueryClient();
    let calls = 0;
    const options = { queryKey: ["clinic-settings", "o"], queryFn: () => Promise.resolve(++calls), ...REFERENCE };
    await client.query(options);
    await client.query(options);
    expect(calls).toBe(1);
    await client.invalidateQueries({ queryKey: ["clinic-settings", "o"] });
    await client.query(options);
    expect(calls).toBe(2);
  });
});
