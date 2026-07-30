import { siteConfig } from '@/config/site';
import { escapeHtml } from '@/lib/security/sanitize';

/**
 * Transactional email shell.
 *
 * Plain template strings rather than React Email: these are table-based layouts
 * with inline styles because that is what Outlook and Gmail require, and a
 * component renderer buys nothing when the output has to look like 2003 HTML
 * anyway. Every dynamic value goes through `escapeHtml`.
 */

export interface EmailTemplate {
  subject: string;
  html: string;
  text: string;
}

interface ShellOptions {
  heading: string;
  bodyHtml: string;
  cta?: { label: string; url: string };
  footnote?: string;
}

const BRAND = '#E91E63';
const INK = '#333333';
const MUTED = '#6b6b6b';

export function renderEmail({ heading, bodyHtml, cta, footnote }: ShellOptions): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(heading)}</title>
</head>
<body style="margin:0;padding:0;background:#F5F5F5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:${INK};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F5F5F5;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFFFFF;border-radius:14px;overflow:hidden;">
        <tr><td style="padding:32px 32px 8px;">
          <p style="margin:0;font-size:12px;letter-spacing:0.14em;text-transform:uppercase;font-weight:600;color:${BRAND};">${escapeHtml(siteConfig.name)}</p>
        </td></tr>
        <tr><td style="padding:8px 32px 0;">
          <h1 style="margin:0;font-size:26px;line-height:1.2;font-weight:600;color:${INK};">${escapeHtml(heading)}</h1>
        </td></tr>
        <tr><td style="padding:16px 32px 0;font-size:15px;line-height:1.65;color:${MUTED};">
          ${bodyHtml}
        </td></tr>
        ${
          cta
            ? `<tr><td style="padding:28px 32px 0;">
          <a href="${cta.url}" style="display:inline-block;background:${BRAND};color:#FFFFFF;text-decoration:none;font-weight:500;font-size:15px;padding:14px 28px;border-radius:10px;">${escapeHtml(cta.label)}</a>
        </td></tr>
        <tr><td style="padding:16px 32px 0;font-size:12px;line-height:1.6;color:#8f8f8f;word-break:break-all;">
          Or paste this link into your browser:<br>${cta.url}
        </td></tr>`
            : ''
        }
        ${
          footnote
            ? `<tr><td style="padding:24px 32px 0;font-size:12px;line-height:1.6;color:#8f8f8f;">${escapeHtml(footnote)}</td></tr>`
            : ''
        }
        <tr><td style="padding:32px;">
          <hr style="border:none;border-top:1px solid #ebebeb;margin:0 0 16px;">
          <p style="margin:0;font-size:12px;line-height:1.6;color:#8f8f8f;">
            ${escapeHtml(siteConfig.legalName)}<br>
            Questions? <a href="mailto:${siteConfig.contact.email}" style="color:${BRAND};">${siteConfig.contact.email}</a>
          </p>
        </td></tr>
      </table>
      <p style="margin:20px 0 0;font-size:11px;color:#8f8f8f;">Sent in plain, unbranded packaging — and so is your order.</p>
    </td></tr>
  </table>
</body>
</html>`;
}
