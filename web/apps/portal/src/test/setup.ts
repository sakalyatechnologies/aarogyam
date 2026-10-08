import { cleanup, configure } from "@testing-library/react";
import { afterEach } from "vitest";

// Pages load lazily; on a busy machine (a concurrent cargo build, or CI) the default 1s is too tight.
configure({ asyncUtilTimeout: 6000 });

afterEach(() => {
  cleanup();
  sessionStorage.clear();
});

// jsdom has no IntersectionObserver; motion's `useInView` needs one. Everything counts as on screen.
class OnScreen implements IntersectionObserver {
  readonly root = null;
  readonly rootMargin = "0px";
  readonly scrollMargin = "0px";
  readonly thresholds: readonly number[] = [0];
  constructor(private readonly callback: IntersectionObserverCallback) {}
  observe(target: Element) {
    const rect = target.getBoundingClientRect();
    const entry: IntersectionObserverEntry = { target, isIntersecting: true, intersectionRatio: 1, boundingClientRect: rect, intersectionRect: rect, rootBounds: null, time: 0 };
    this.callback([entry], this);
  }
  unobserve() {}
  disconnect() {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}
if (typeof globalThis.IntersectionObserver === "undefined") {
  globalThis.IntersectionObserver = OnScreen;
}
