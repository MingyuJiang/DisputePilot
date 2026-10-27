import "@testing-library/jest-dom/vitest";
import { beforeEach } from "vitest";

// Component tests assert the English copy unless a test explicitly switches
// language. The dictionary fallback is read when the i18n module loads, so the
// default must be in place before the test files import it.
window.localStorage.setItem("dp.demo.lang", "en");

beforeEach(() => {
  // Role and language are persisted presentation state; isolate every test.
  window.localStorage.setItem("dp.demo.lang", "en");
  window.localStorage.removeItem("dp.demo.role");
});

// jsdom does not implement matchMedia or scrollTo; the shell calls scrollTo on
// case navigation, so provide a no-op rather than stubbing per test.
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

window.scrollTo = () => undefined;
