import '@testing-library/react';

/**
 * Test bootstrap.
 *
 * `env.ts` validates on import and would abort the suite, so the required
 * variables are stubbed here with obviously-fake values. Anything that needs a
 * real database belongs in an integration test with its own throwaway schema.
 */

/**
 * CI exports `SKIP_ENV_VALIDATION=true` so that `tsc` and `next build` can run
 * without real secrets. Inheriting it here would make `env.ts` hand back
 * `process.env` unchecked, and every test asserting that validation *rejects*
 * something would silently pass nothing. Tests always exercise the real path.
 */
delete process.env.SKIP_ENV_VALIDATION;
process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';
process.env.AUTH_SECRET ??= 'test-secret-value-at-least-32-characters-long';
process.env.NEXT_PUBLIC_SITE_URL ??= 'https://example.test';
