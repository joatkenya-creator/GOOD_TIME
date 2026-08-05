import { describe, expect, it } from 'vitest';

import { passwordChangedTemplate, passwordResetTemplate, verifyEmailTemplate } from '@/emails/auth';
import { renderEmail } from '@/emails/layout';

/**
 * Transactional email templates.
 *
 * Email is the one output nobody can hotfix. Once it is in an inbox it is
 * there, so the checks here are about the failures that are permanent rather
 * than cosmetic: an injected script, a missing plain-text part landing the
 * whole send in spam, a token leaked into a subject line that shows in a
 * notification on a lock screen.
 *
 * This shop ships discreetly. That is a promise the *emails* have to keep too —
 * a subject line naming a product on someone's phone screen is exactly the
 * failure the packaging avoids.
 */

const TOKEN_URL = 'https://example.test/reset-password?token=abc123secret';

describe('every template', () => {
  const templates = [
    ['verify email', verifyEmailTemplate(TOKEN_URL, 'Ada')],
    ['password reset', passwordResetTemplate(TOKEN_URL, 'Ada')],
    ['password changed', passwordChangedTemplate('Ada')],
  ] as const;

  it.each(templates)('%s has both an HTML and a plain-text part', (_name, template) => {
    /*
     * Not optional. A multipart message with no text/plain alternative scores
     * badly with every major spam filter, and a password reset landing in spam
     * is a support ticket that starts with a locked-out customer.
     */
    expect(template.html).toContain('<!doctype html>');
    expect(template.text.length).toBeGreaterThan(40);
    expect(template.text).not.toContain('<');
  });

  it.each(templates)('%s has a subject that survives a lock screen', (_name, template) => {
    expect(template.subject.length).toBeGreaterThan(10);
    // Gmail truncates around 70 characters on mobile.
    expect(template.subject.length).toBeLessThan(70);
    // Discreet: nothing in a subject line should describe what was bought.
    expect(template.subject.toLowerCase()).not.toMatch(/lingerie|toy|intimate/);
    // A token in a subject is visible in a notification preview.
    expect(template.subject).not.toContain('abc123secret');
  });

  it.each(templates)('%s declares a viewport so it is readable on a phone', (_name, template) => {
    expect(template.html).toContain('name="viewport"');
  });

  it.each(templates)('%s uses table layout, which is what Outlook renders', (_name, template) => {
    // Flexbox and grid are silently ignored by Word's rendering engine, which
    // is still what desktop Outlook uses.
    expect(template.html).toContain('<table');
    expect(template.html).toContain('role="presentation"');
  });
});

describe('escaping', () => {
  it('escapes a name that contains markup', () => {
    /*
     * The realistic version of this is not an attacker — it is a customer whose
     * display name legitimately contains `&` or `<`, entered through a form
     * that accepted it. Either way the output must be inert.
     */
    const template = verifyEmailTemplate(TOKEN_URL, '<script>alert(1)</script>');

    expect(template.html).not.toContain('<script>alert(1)</script>');
  });

  it('escapes the heading', () => {
    const html = renderEmail({
      heading: 'Tom & Jerry <b>sale</b>',
      bodyHtml: '<p>Body</p>',
    });

    expect(html).toContain('Tom &amp; Jerry');
    expect(html).not.toContain('<b>sale</b>');
  });

  it('leaves deliberate body markup alone', () => {
    // `bodyHtml` is authored by us, not by a user. Escaping it would render
    // every template as visible tag soup.
    const html = renderEmail({
      heading: 'Hello',
      bodyHtml: '<p style="margin:0;">Real markup</p>',
    });

    expect(html).toContain('<p style="margin:0;">Real markup</p>');
  });
});

describe('links', () => {
  it('shows the URL as text as well as a button', () => {
    const html = renderEmail({
      heading: 'Confirm',
      bodyHtml: '<p>Body</p>',
      cta: { label: 'Confirm', url: TOKEN_URL },
    });

    // Some clients strip styled anchors, and some people simply do not trust a
    // button. A pasteable URL is what makes the email work anyway.
    expect(html).toContain(TOKEN_URL);
    expect(html).toContain('paste this link');
  });

  it('names the sender and gives a reply path in the footer', () => {
    const html = renderEmail({ heading: 'Hello', bodyHtml: '<p>Body</p>' });

    // CAN-SPAM requires an identifiable sender; a reply path is what stops a
    // confused customer reporting the message as phishing.
    expect(html).toContain('mailto:');
  });
});

describe('greeting', () => {
  it('falls back gracefully when there is no name', () => {
    // Guest checkout means a first name is genuinely optional. "Hi ," is the
    // classic tell that a template was never tested without one.
    const named = verifyEmailTemplate(TOKEN_URL, 'Ada');
    const anonymous = verifyEmailTemplate(TOKEN_URL, null);

    expect(named.text).toContain('Hi Ada,');
    expect(anonymous.text).toContain('Hi there,');
    expect(anonymous.text).not.toContain('Hi ,');
  });
});
