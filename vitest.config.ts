import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
    // Server-only modules and the generated client have no place in a unit test run.
    exclude: ['node_modules', '.next', 'src/generated'],

    /*
     * 30s, not the 5s default.
     *
     * Several suites call `vi.resetModules()` and then re-`import()` a module
     * to exercise a different environment — which is the only way to test code
     * that reads `env` at module load. That re-import re-evaluates the whole
     * transitive graph, and for anything touching `payment.service` that graph
     * includes the generated Prisma client.
     *
     * On an idle machine it finishes in well under a second. On a machine also
     * running a build it exceeded 5s and the suite failed with two timeouts
     * that look exactly like assertion failures and are not — the tests were
     * still loading. That is a fragile default for a suite that runs in CI
     * alongside other jobs.
     *
     * This budget is for module loading, not for hiding slow tests. Anything
     * genuinely taking tens of seconds in a *unit* suite is doing I/O it should
     * not be doing.
     */
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // See tests/server-only-stub.ts — jsdom resolves the real package to a
      // build that throws on import, which would make every service untestable.
      'server-only': fileURLToPath(new URL('./tests/server-only-stub.ts', import.meta.url)),
    },
  },
});
