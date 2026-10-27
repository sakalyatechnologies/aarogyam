import { describe, expect, it } from "vitest";

import { createFakeBackend, createFixtures, fakeTokenFor } from "./index.js";

const NOW = new Date("2026-10-03T05:30:00Z");
const ASHA = "a1a1a1a1-0000-4000-8000-000000000001";

describe("dismissRecall (fake)", () => {
  it("dismisses once, drops it from the due list, then refuses a second time", async () => {
    const backend = createFakeBackend(createFixtures({ now: NOW }));
    const api = backend.client({ host: "sunrise.localtest.me", getToken: () => fakeTokenFor({ id: ASHA }), now: () => NOW });
    const list = await api.listRecallsDue();
    if (!list.ok) throw new Error("list failed");
    const first = list.value.items[0];
    if (first === undefined) throw new Error("no recalls");
    const out = await api.dismissRecall(first.id, { reason: "seen elsewhere" });
    expect(out.ok && out.value.status).toBe("dismissed");
    const after = await api.listRecallsDue();
    expect(after.ok && after.value.items.some((r) => r.id === first.id)).toBe(false);
    const again = await api.dismissRecall(first.id, {});
    expect(!again.ok && again.error.code).toBe("conflict");
    const missing = await api.dismissRecall("00000000-0000-4000-8000-000000000000", {});
    expect(missing.ok).toBe(false);
  });
});
