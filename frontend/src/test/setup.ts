/**
 * Vitest setup: Testing Library matchers plus the browser APIs jsdom lacks (ResizeObserver,
 * matchMedia, scrollTo, rAF-based measurement) so components render as in a browser.
 */
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
if (!("ResizeObserver" in window)) {
  Object.defineProperty(window, "ResizeObserver", { value: ResizeObserverStub, writable: true });
  Object.defineProperty(globalThis, "ResizeObserver", { value: ResizeObserverStub, writable: true });
}

if (!window.matchMedia) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
}

// jsdom implements window.scrollTo as a "not implemented" stub that logs an error.
window.scrollTo = (() => undefined) as typeof window.scrollTo;

if (!Element.prototype.scrollTo) {
  Element.prototype.scrollTo = function scrollTo() {};
}
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView() {};
}
