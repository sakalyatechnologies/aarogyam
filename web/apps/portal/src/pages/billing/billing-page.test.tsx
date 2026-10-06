import { screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ApiClient } from "@aarogyam/api-client";

import { fakeApi, PEOPLE, renderPortal } from "../../test/render.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("BillingPage", () => {
  it("makes exactly one collections request for both month KPIs and the weekly chart", async () => {
    let collectionsCalls = 0;
    const backend = fakeApi();
    const wrap = (client: ApiClient): ApiClient => {
      const original = client.getCollections.bind(client);
      client.getCollections = (...args) => {
        collectionsCalls += 1;
        return original(...args);
      };
      return client;
    };
    renderPortal("/billing", { as: PEOPLE.asha, backend, wrap });

    await waitFor(() => {
      expect(screen.getByText("Weekly collections")).toBeTruthy();
    });

    expect(collectionsCalls).toBe(1);
  });
});
