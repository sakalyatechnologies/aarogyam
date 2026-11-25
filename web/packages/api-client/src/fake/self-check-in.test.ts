import { describe, expect, it } from "vitest";

import type { ApiClient, ApiResult } from "../index.js";
import { createFakeBackend, createFixtures, fakeTokenFor } from "./index.js";

const NOW = new Date("2026-10-03T05:30:00Z");
const SUNRISE = "sunrise.localtest.me";
const LOTUS = "lotus.localtest.me";
const ASHA = "a1a1a1a1-0000-4000-8000-000000000001";
const FARAH = "a1a1a1a1-0000-4000-8000-000000000003";
const BINA = "b1b1b1b1-0000-4000-8000-000000000001";

function setup() {
  const backend = createFakeBackend(createFixtures({ now: NOW }));
  const as = (who: string, host = SUNRISE): ApiClient => backend.client({ host, getToken: () => fakeTokenFor({ id: who }), now: () => NOW });
  const visitor = (host = SUNRISE): ApiClient => backend.client({ host, now: () => NOW });
  return { as, visitor };
}

function value<T>(result: ApiResult<T>): T {
  if (!result.ok) throw new Error(`expected success, got ${result.error.code}: ${result.error.message}`);
  return result.value;
}

function keyOf(url: string | null | undefined): string {
  return new URL(url ?? "").searchParams.get("k") ?? "";
}

const arrival = (k: string) => ({
  k,
  first_name: "Asha",
  phone: "98765 43210",
  reasons: ["tooth_pain"],
  consent_care: true,
  for_self: true,
});

describe("QR self check-in (fake, same contract as the API)", () => {
  it("opens with the key, makes requests the desk accepts once, and keeps clinics apart", async () => {
    const { as, visitor } = setup();
    expect((await visitor().getArrivePage("x")).ok).toBe(false);
    const off = value(await as(ASHA).getSelfCheckInSettings());
    expect(off.enabled).toBe(false);
    expect(off.url ?? null).toBeNull();
    expect((await as(FARAH).setSelfCheckIn(true)).ok).toBe(false);

    const key = keyOf(value(await as(ASHA).setSelfCheckIn(true)).url);
    expect(value(await visitor().getArrivePage(key)).reasons.length).toBeGreaterThan(0);
    expect((await visitor(LOTUS).getArrivePage(key)).ok).toBe(false);
    expect((await visitor().sendArrival(arrival("wrong"))).ok).toBe(false);
    expect((await visitor().sendArrival({ ...arrival(key), consent_care: false })).ok).toBe(false);
    expect((await visitor().sendArrival({ ...arrival(key), website: "spam" })).ok).toBe(true);
    expect(value(await as(FARAH).listArrivals()).items).toHaveLength(0);

    value(await visitor().sendArrival(arrival(key)));
    const waiting = value(await as(FARAH).listArrivals()).items;
    expect(waiting).toHaveLength(1);
    expect(value(await as(BINA, LOTUS).listArrivals()).items).toHaveLength(0);
    const id = waiting[0]?.id ?? "";
    expect((await as(BINA, LOTUS).dismissArrival(id)).ok).toBe(false);

    const accepted = value(await as(FARAH).acceptArrival(id, {}));
    expect(accepted.registered).toBe(true);
    expect(accepted.consents_recorded).toContain("care");
    expect((await as(FARAH).acceptArrival(id, {})).ok).toBe(false);
    expect(value(await as(FARAH).listArrivals()).items).toHaveLength(0);

    // A new key voids the old one.
    const fresh = keyOf(value(await as(ASHA).newSelfCheckInKey()).url);
    expect(fresh).not.toBe(key);
    expect((await visitor().getArrivePage(key)).ok).toBe(false);
    expect(value(await visitor().lookupPincode("411001")).district).toBe("Pune");
    expect((await visitor().lookupPincode("011001")).ok).toBe(false);
  });
});
