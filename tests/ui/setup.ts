import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
});
Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
  value() {
    this.setAttribute("open", "");
  },
});
Object.defineProperty(HTMLDialogElement.prototype, "close", {
  value() {
    this.removeAttribute("open");
  },
});
Object.defineProperty(window, "matchMedia", {
  configurable: true,
  writable: true,
  value: vi.fn(() => ({
    matches: true,
    addEventListener() {},
    removeEventListener() {},
  })),
});
