import { cleanup, configure } from "@testing-library/react";
import { afterEach } from "vitest";

// Queries wait 1 s by default, which flakes when several suites share a busy machine (same reason as testTimeout).
configure({ asyncUtilTimeout: 5000 });

afterEach(() => {
  cleanup();
  sessionStorage.clear();
});
