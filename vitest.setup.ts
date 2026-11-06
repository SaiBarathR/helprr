// Shared Vitest setup. A test runs in Node unless its file opts into a DOM with
// `// @vitest-environment jsdom`; nothing here changes that.
import { afterEach } from 'vitest';

// findBy*/waitFor give up after 1 s by default. A component's first query
// compiles Testing Library's accessibility code from cold (tens of ms idle),
// and with several full suites sharing the CPU that alone can pass 1 s. Keep
// the wait under Vitest's 5 s test timeout so a real failure still shows the DOM.
if (typeof document !== 'undefined') {
  const { configure } = await import('@testing-library/react');
  configure({ asyncUtilTimeout: 3000 });
}

// React Testing Library unmounts what a test rendered only when the runner
// exposes afterEach globally, which Vitest does not. Component tests rely on it.
afterEach(async () => {
  if (typeof document === 'undefined') return;
  const { cleanup } = await import('@testing-library/react');
  cleanup();
});
