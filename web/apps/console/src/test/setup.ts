import { cleanup, configure } from "@testing-library/react";
import { afterEach } from "vitest";

// The first render in each file waits on a cold module transform; under a parallel run the default 1s is too tight.
configure({ asyncUtilTimeout: 15_000 });

afterEach(cleanup);
