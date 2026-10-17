// Shared Vitest setup. A test runs in Node unless its file opts into a DOM with
// `// @vitest-environment jsdom`; nothing here changes that.
import { afterEach } from 'vitest';

// React Testing Library unmounts what a test rendered only when the runner
// exposes afterEach globally, which Vitest does not. Component tests rely on it.
afterEach(async () => {
  if (typeof document === 'undefined') return;
  const { cleanup } = await import('@testing-library/react');
  cleanup();
});
