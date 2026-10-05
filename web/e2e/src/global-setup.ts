/**
 * Before any test: the e2e stack must answer, or the run stops with how to start it, instead of
 * every test timing out on its own.
 */
import { API_URL, CONSOLE_URL, PORTAL_PORT, THROTTLE_BYPASS, THROTTLE_BYPASS_HEADER } from "./stack.ts";

async function answers(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { headers: { [THROTTLE_BYPASS_HEADER]: THROTTLE_BYPASS }, signal: AbortSignal.timeout(10_000) });
    return response.ok;
  } catch {
    return false;
  }
}

export default async function globalSetup(): Promise<void> {
  const portal = `http://app.localtest.me:${PORTAL_PORT}`;
  const up = await Promise.all([answers(`${API_URL}/healthz`), answers(`${CONSOLE_URL}/`), answers(`${portal}/`)]);
  if (up.includes(false)) {
    throw new Error(
      `The e2e stack isn't up (API ${API_URL}, console ${CONSOLE_URL}, portal ${portal}). Start it with scripts/e2e-stack.sh up.`,
    );
  }
}
