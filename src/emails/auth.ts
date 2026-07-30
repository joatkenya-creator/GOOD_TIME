import { siteConfig } from '@/config/site';
import { type EmailTemplate, renderEmail } from '@/emails/layout';

/** Templates for the account lifecycle. Order and shipping emails arrive in phase 4. */

export function verifyEmailTemplate(url: string, firstName?: string | null): EmailTemplate {
  const greeting = firstName ? `Hi ${firstName},` : 'Hi there,';

  return {
    subject: `Confirm your ${siteConfig.name} email address`,
    html: renderEmail({
      heading: 'Confirm your email',
      bodyHtml: `<p style="margin:0 0 12px;">${greeting}</p>
        <p style="margin:0;">Confirm this address to finish setting up your account. The link expires in 24 hours.</p>`,
      cta: { label: 'Confirm email address', url },
      footnote: 'If you did not create an account, you can safely ignore this email.',
    }),
    text: `${greeting}\n\nConfirm your email address to finish setting up your ${siteConfig.name} account:\n${url}\n\nThe link expires in 24 hours. If you did not create an account, ignore this email.`,
  };
}

export function passwordResetTemplate(url: string, firstName?: string | null): EmailTemplate {
  const greeting = firstName ? `Hi ${firstName},` : 'Hi there,';

  return {
    subject: `Reset your ${siteConfig.name} password`,
    html: renderEmail({
      heading: 'Reset your password',
      bodyHtml: `<p style="margin:0 0 12px;">${greeting}</p>
        <p style="margin:0;">Use the button below to choose a new password. The link expires in one hour and can be used once.</p>`,
      cta: { label: 'Choose a new password', url },
      footnote:
        'If you did not request this, no action is needed — your password has not been changed.',
    }),
    text: `${greeting}\n\nReset your ${siteConfig.name} password:\n${url}\n\nThe link expires in one hour and can be used once. If you did not request this, ignore this email.`,
  };
}

export function passwordChangedTemplate(firstName?: string | null): EmailTemplate {
  const greeting = firstName ? `Hi ${firstName},` : 'Hi there,';

  return {
    subject: `Your ${siteConfig.name} password was changed`,
    html: renderEmail({
      heading: 'Your password was changed',
      bodyHtml: `<p style="margin:0 0 12px;">${greeting}</p>
        <p style="margin:0;">This is a confirmation that the password on your account was just changed.</p>`,
      footnote: `If this wasn't you, contact us immediately at ${siteConfig.contact.email}.`,
    }),
    text: `${greeting}\n\nThe password on your ${siteConfig.name} account was just changed. If this wasn't you, contact ${siteConfig.contact.email} immediately.`,
  };
}
