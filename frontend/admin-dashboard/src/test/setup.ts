import "@testing-library/jest-dom/vitest";

// jsdom doesn't implement matchMedia; components that read prefers-reduced-motion
// (framer-motion's useReducedMotion) need a stub so component tests don't crash.
if (!window.matchMedia) {
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}
