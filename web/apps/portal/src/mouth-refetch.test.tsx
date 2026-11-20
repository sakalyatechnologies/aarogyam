import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { randomUuid, unwrap } from "@aarogyam/api-client";

import { useBookAppointment, useSetToothStatus } from "./queries.js";
import { clinic } from "./test/clinic-wrapper.js";
import { NOW } from "./test/render.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Present mode refetches the mouth snapshot (DF6)", () => {
  it("after a tooth-status save", async () => {
    const { wrapper, api, mouthCalls } = await clinic();
    const patients = await unwrap(api.listPatients({}));
    const patient = patients.items[0];
    if (patient === undefined) throw new Error("no patient");
    const { result } = renderHook(() => useSetToothStatus(patient.id), { wrapper });
    act(() => {
      result.current.mutate({ tooth: 21, input: { health: "watch", client_id: randomUuid() }, status: { tooth: 21, health: "watch", recorded_at: NOW.toISOString() } });
    });
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });
    expect(mouthCalls()).toBe(1);
  });

  it("after a booking", async () => {
    const { wrapper, api, mouthCalls } = await clinic();
    const patient = (await unwrap(api.listPatients({}))).items[0];
    const practitioner = (await unwrap(api.listPractitioners())).items[0];
    if (patient === undefined || practitioner === undefined) throw new Error("no patient or practitioner");
    const { result } = renderHook(() => useBookAppointment(), { wrapper });
    act(() => {
      result.current.mutate({ patient_id: patient.id, practitioner_id: practitioner.id, starts_at: "2026-10-06T10:00:00+05:30", ends_at: "2026-10-06T10:30:00+05:30" });
    });
    await waitFor(() => { expect(result.current.isPending).toBe(false); });
    expect(result.current.error).toBeNull();
    expect(mouthCalls()).toBe(1);
  });
});
