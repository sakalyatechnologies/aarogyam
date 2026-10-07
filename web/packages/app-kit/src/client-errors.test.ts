import { describe, expect, it } from "vitest";

import { installClientErrorReporting } from "./client-errors.js";

function setup() {
  const events = new EventTarget();
  const target = {
    addEventListener: (type: string, listener: (event: Event) => void) => { events.addEventListener(type, listener); },
    removeEventListener: (type: string, listener: (event: Event) => void) => { events.removeEventListener(type, listener); },
    dispatchEvent: (event: Event) => events.dispatchEvent(event),
    location: { pathname: "/patients/SC-1042" },
  };
  const sent: { url: string; body: unknown }[] = [];
  const stop = installClientErrorReporting({
    app: "portal",
    release: "1.0.0",
    target,
    send: (url, body) => {
      const parsed: unknown = JSON.parse(body);
      sent.push({ url, body: parsed });
    },
  });
  return { target, sent, stop };
}

function fire(target: { dispatchEvent: (event: Event) => boolean }, type: string, fields: Record<string, unknown>) {
  const event = new Event(type);
  Object.assign(event, fields);
  target.dispatchEvent(event);
}

describe("installClientErrorReporting", () => {
  it("sends the name, message, stack and path of an uncaught error", () => {
    const { target, sent } = setup();
    fire(target, "error", { error: new TypeError("x is undefined") });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.url).toBe("/api/v1/client-errors");
    expect(sent[0]?.body).toMatchObject({ app: "portal", kind: "error", name: "TypeError", message: "x is undefined", page: "/patients/SC-1042", release: "1.0.0" });
    expect(sent[0]?.body).toHaveProperty("stack");
  });

  it("sends only the type of something that is not an error", () => {
    const { target, sent } = setup();
    fire(target, "unhandledrejection", { reason: { patient: "Asha Rao" } });
    expect(JSON.stringify(sent)).not.toContain("Asha");
    expect(sent[0]?.body).toMatchObject({ kind: "unhandledrejection", name: "NonError", message: "thrown object" });
  });

  it("sends each error once and stops after five", () => {
    const { target, sent } = setup();
    for (let i = 0; i < 3; i++) fire(target, "error", { error: new Error("same") });
    expect(sent).toHaveLength(1);
    for (let i = 0; i < 10; i++) fire(target, "error", { error: new Error(`different ${String(i)}`) });
    expect(sent).toHaveLength(5);
  });

  it("stops listening when asked", () => {
    const { target, sent, stop } = setup();
    stop();
    fire(target, "error", { error: new Error("late") });
    expect(sent).toHaveLength(0);
  });
});
