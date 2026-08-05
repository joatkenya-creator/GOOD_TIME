import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Environment contract.
 *
 * Both cases below were real boot failures caused by copying `.env.example`
 * verbatim, so they are worth a permanent guard:
 *
 *   1. dotenv loads `STRIPE_SECRET_KEY=` as `''`, not as absent, so `.optional()`
 *      never engaged and `.startsWith('sk_')` rejected the empty string.
 *   2. `EMAIL_FROM` is a display-name address (`Name <a@b.com>`) — the format
 *      Resend wants — which a bare `z.email()` rejects.
 */

/** Re-imports `env.ts` with a patched environment; it validates at module load. */
async function loadEnv(overrides: Record<string, string>) {
  vi.resetModules();
  for (const [key, value] of Object.entries(overrides)) vi.stubEnv(key, value);
  return (await import('@/lib/env')).env;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('server env', () => {
  it('treats a blank optional variable as absent', async () => {
    const env = await loadEnv({
      KLARNA_USERNAME: '',
      KLARNA_PASSWORD: '',
      RESEND_API_KEY: '',
      CLOUDINARY_CLOUD_NAME: '',
      AUTH_GOOGLE_ID: '',
      UPSTASH_REDIS_REST_URL: '',
      SENTRY_DSN: '',
    });

    expect(env.KLARNA_USERNAME).toBeUndefined();
    expect(env.RESEND_API_KEY).toBeUndefined();
    // A blank URL must be absent rather than a validation failure — `.env`
    // files spell "unset" as `FOO=`, and `z.url()` would reject `''`.
    expect(env.UPSTASH_REDIS_REST_URL).toBeUndefined();
    expect(env.SENTRY_DSN).toBeUndefined();
  });

  it('reports every integration as unconfigured when the keys are blank', async () => {
    vi.resetModules();
    vi.stubEnv('KLARNA_USERNAME', '');
    vi.stubEnv('KLARNA_PASSWORD', '');
    vi.stubEnv('RESEND_API_KEY', '');
    vi.stubEnv('CLOUDINARY_CLOUD_NAME', '');
    vi.stubEnv('AUTH_GOOGLE_ID', '');
    vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '');
    vi.stubEnv('SENTRY_DSN', '');
    vi.stubEnv('TURNSTILE_SECRET_KEY', '');

    const { integrations } = await import('@/lib/env');

    expect(integrations).toEqual({
      klarna: false,
      resend: false,
      cloudinary: false,
      googleOAuth: false,
      upstash: false,
      sentry: false,
      turnstile: false,
    });
  });

  it('accepts EMAIL_FROM with a display name', async () => {
    const env = await loadEnv({ EMAIL_FROM: 'GOOD TIME <no-reply@example.com>' });
    expect(env.EMAIL_FROM).toBe('GOOD TIME <no-reply@example.com>');
  });

  it('accepts EMAIL_FROM as a bare address', async () => {
    const env = await loadEnv({ EMAIL_FROM: 'no-reply@example.com' });
    expect(env.EMAIL_FROM).toBe('no-reply@example.com');
  });

  it('rejects an EMAIL_FROM that holds no address', async () => {
    await expect(loadEnv({ EMAIL_FROM: 'GOOD TIME <not-an-address>' })).rejects.toThrow(
      /Invalid environment variables/,
    );
  });

  it('still rejects a missing required variable', async () => {
    await expect(loadEnv({ AUTH_SECRET: '' })).rejects.toThrow(/AUTH_SECRET/);
  });

  it('rejects an AUTH_SECRET that is too short to be safe', async () => {
    await expect(loadEnv({ AUTH_SECRET: 'too-short' })).rejects.toThrow(/AUTH_SECRET/);
  });
});
