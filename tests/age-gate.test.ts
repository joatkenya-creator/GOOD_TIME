import { describe, expect, it } from 'vitest';

import { AGE_COOKIE, AGE_GATE_INLINE_SCRIPT, hasAgeConsent } from '@/lib/age-gate';

/**
 * The age gate is a compliance formality, not a security control — but the cookie
 * check still has to be right in both directions. A false positive lets an
 * unconfirmed visitor straight through; a false negative re-asks a customer on
 * every page load.
 */
describe('hasAgeConsent', () => {
  it('detects the cookie on its own', () => {
    expect(hasAgeConsent(`${AGE_COOKIE}=1`)).toBe(true);
  });

  it('detects it among others, in any position', () => {
    expect(hasAgeConsent(`other=x; ${AGE_COOKIE}=1; more=y`)).toBe(true);
    expect(hasAgeConsent(`${AGE_COOKIE}=1; other=x`)).toBe(true);
    expect(hasAgeConsent(`other=x; ${AGE_COOKIE}=1`)).toBe(true);
  });

  it('is false when absent or empty', () => {
    expect(hasAgeConsent('')).toBe(false);
    expect(hasAgeConsent('session=abc; theme=dark')).toBe(false);
  });

  it('does not accept a value other than 1', () => {
    expect(hasAgeConsent(`${AGE_COOKIE}=0`)).toBe(false);
    expect(hasAgeConsent(`${AGE_COOKIE}=`)).toBe(false);
  });

  it('does not match a cookie whose name merely ends with ours', () => {
    // The bug a naive `indexOf` would introduce.
    expect(hasAgeConsent(`not_${AGE_COOKIE}=1`)).toBe(false);
    expect(hasAgeConsent(`x${AGE_COOKIE}=1`)).toBe(false);
  });

  it('does not match a cookie whose name merely starts with ours', () => {
    expect(hasAgeConsent(`${AGE_COOKIE}_other=1`)).toBe(false);
  });
});

describe('AGE_GATE_INLINE_SCRIPT', () => {
  /**
   * The script is injected with `dangerouslySetInnerHTML`, so it must stay
   * syntactically valid and free of anything that could break out of the tag.
   */
  it('is valid JavaScript', () => {
    expect(() => new Function(AGE_GATE_INLINE_SCRIPT)).not.toThrow();
  });

  it('cannot close the script element', () => {
    expect(AGE_GATE_INLINE_SCRIPT).not.toContain('</script');
  });

  it('agrees with hasAgeConsent on both the match and the near-miss', () => {
    const documentStub = { cookie: `${AGE_COOKIE}=1`, documentElement: attributeSpy() };
    run(AGE_GATE_INLINE_SCRIPT, documentStub);
    expect(documentStub.documentElement.calls).toHaveLength(1);

    const nearMiss = { cookie: `not_${AGE_COOKIE}=1`, documentElement: attributeSpy() };
    run(AGE_GATE_INLINE_SCRIPT, nearMiss);
    expect(nearMiss.documentElement.calls).toHaveLength(0);
  });
});

function attributeSpy() {
  const calls: [string, string][] = [];
  return {
    calls,
    setAttribute: (name: string, value: string) => calls.push([name, value]),
  };
}

/** Executes the inline script against a stub `document`. */
function run(source: string, documentStub: unknown): void {
  new Function('document', source)(documentStub);
}
