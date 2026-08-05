import { siteConfig } from '@/config/site';
import { type EmailTemplate, renderEmail } from '@/emails/layout';
import { escapeHtml } from '@/lib/security/sanitize';

/** Templates for the account lifecycle. */

/**
 * The greeting, in two forms, because they land in two different contexts.
 *
 * `renderEmail` escapes the heading and the footnote but passes `bodyHtml`
 * through untouched — it has to, or every template would render as visible tag
 * soup. That makes anything interpolated into `bodyHtml` this function's
 * responsibility, and a first name is user input: it arrives from a
 * registration form, it can contain `&`, `<` or a deliberate `<script>`, and it
 * is stored and replayed into every email that account ever receives.
 *
 * The plain-text part is deliberately *not* escaped. `&amp;` in a text/plain
 * body is not safer, it is just wrong.
 */
function greeting(firstName?: string | null): { html: string; text: string } {
  if (!firstName) return { html: 'Hi there,', text: 'Hi there,' };

  return { html: `Hi ${escapeHtml(firstName)},`, text: `Hi ${firstName},` };
}

export function verifyEmailTemplate(url: string, firstName?: string | null): EmailTemplate {
  const hello = greeting(firstName);

  return {
    subject: `Confirm your ${siteConfig.name} email address`,
    html: renderEmail({
      heading: 'Confirm your email',
      bodyHtml: `<p style="margin:0 0 12px;">${hello.html}</p>
        <p style="margin:0;">Confirm this address to finish setting up your account. The link expires in 24 hours.</p>`,
      cta: { label: 'Confirm email address', url },
      footnote: 'If you did not create an account, you can safely ignore this email.',
    }),
    text: `${hello.text}\n\nConfirm your email address to finish setting up your ${siteConfig.name} account:\n${url}\n\nThe link expires in 24 hours. If you did not create an account, ignore this email.`,
  };
}

export function passwordResetTemplate(url: string, firstName?: string | null): EmailTemplate {
  const hello = greeting(firstName);

  return {
    subject: `Reset your ${siteConfig.name} password`,
    html: renderEmail({
      heading: 'Reset your password',
      bodyHtml: `<p style="margin:0 0 12px;">${hello.html}</p>
        <p style="margin:0;">Use the button below to choose a new password. The link expires in one hour and can be used once.</p>`,
      cta: { label: 'Choose a new password', url },
      footnote:
        'If you did not request this, no action is needed — your password has not been changed.',
    }),
    text: `${hello.text}\n\nReset your ${siteConfig.name} password:\n${url}\n\nThe link expires in one hour and can be used once. If you did not request this, ignore this email.`,
  };
}

export function passwordChangedTemplate(firstName?: string | null): EmailTemplate {
  const hello = greeting(firstName);

  return {
    subject: `Your ${siteConfig.name} password was changed`,
    html: renderEmail({
      heading: 'Your password was changed',
      bodyHtml: `<p style="margin:0 0 12px;">${hello.html}</p>
        <p style="margin:0;">This is a confirmation that the password on your account was just changed.</p>`,
      footnote: `If this wasn't you, contact us immediately at ${siteConfig.contact.email}.`,
    }),
    text: `${hello.text}\n\nThe password on your ${siteConfig.name} account was just changed. If this wasn't you, contact ${siteConfig.contact.email} immediately.`,
  };
}
