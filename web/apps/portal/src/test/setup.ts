import { cleanup, configure } from "@testing-library/react";
import { afterEach } from "vitest";

// Pages load lazily; on a busy machine (a concurrent cargo build, or CI) the default 1s is too tight.
configure({ asyncUtilTimeout: 6000 });

afterEach(() => {
  cleanup();
  sessionStorage.clear();
});
