import { Lock, PackageCheck, RotateCcw, Truck } from 'lucide-react';
import Link from 'next/link';

import { Container } from '@/components/layout/container';
import { NewsletterForm } from '@/components/forms/newsletter-form';
import { footerNav } from '@/config/navigation';
import { siteConfig } from '@/config/site';
import { ROUTES } from '@/constants/routes';

/** Wordmarks rather than brand logos — no third-party marks are bundled. */
const PAYMENT_METHODS = ['Visa', 'Mastercard', 'Amex', 'Discover', 'PayPal', 'Apple Pay'];

/**
 * `detail` lines are deliberately specific rather than reassuring. "No questions
 * asked" would be untrue for this category — opened toys cannot be resold for
 * hygiene reasons, and overstating the policy is both a support burden and a
 * consumer-protection risk.
 */
const TRUST_BADGES = [
  { icon: Lock, label: 'Secure checkout', detail: 'Neutral billing descriptor' },
  { icon: Truck, label: 'Free shipping', detail: 'Orders over $75' },
  { icon: RotateCcw, label: '30-day returns', detail: 'Unopened items' },
  { icon: PackageCheck, label: 'Discreet packaging', detail: 'Plain, unbranded box' },
];

/**
 * Site footer.
 *
 * Fully server-rendered apart from the newsletter field. The trust strip sits at
 * the top rather than buried at the bottom, because a visitor who scrolled this
 * far is deciding whether to trust us — that is the moment the shipping and
 * returns promises need to be visible.
 */
export interface FooterProps {
  /**
   * Slugs under `/pages/` that actually resolve — the legal documents in code
   * plus every published CMS page.
   *
   * Passed in rather than read here because `components/` may not import
   * `services/`. The storefront layout does the query once for the whole shell.
   */
  availablePages: readonly string[];
}

/**
 * Links to a page that does not exist are not rendered.
 *
 * The footer advertised twelve policy pages — shipping, returns, warranty,
 * contact and the rest — that had never been written. Every one 404'd, and Next
 * prefetches visible links, so those 404s fired on every page view before
 * anyone clicked. A shopper checking whether a retailer is trustworthy reads
 * exactly these, and a dead "Returns & hygiene policy" link answers that
 * question the wrong way.
 *
 * This is the same rule the sitemap already follows: do not publish a URL that
 * 404s. Writing the page in the admin makes its link appear, with no deploy —
 * so the fix stays with whoever owns the content.
 */
function isResolvable(href: string, availablePages: readonly string[]): boolean {
  if (!href.startsWith('/pages/')) return true;
  return availablePages.includes(href.slice('/pages/'.length));
}

export function Footer({ availablePages }: FooterProps) {
  return (
    <footer className="mt-24 border-t border-border bg-surface-muted">
      <Container>
        <ul className="grid gap-8 border-b border-border py-12 sm:grid-cols-2 lg:grid-cols-4">
          {TRUST_BADGES.map(({ icon: Icon, label, detail }) => (
            <li key={label} className="flex items-center gap-3.5">
              <span
                aria-hidden="true"
                className="flex size-11 shrink-0 items-center justify-center rounded-full bg-surface text-accent-text"
              >
                <Icon className="size-5" strokeWidth={1.75} />
              </span>
              <span>
                <span className="block text-body-sm font-semibold text-foreground">{label}</span>
                <span className="block text-xs text-foreground-muted">{detail}</span>
              </span>
            </li>
          ))}
        </ul>

        <div className="grid gap-12 py-14 lg:grid-cols-[1fr_2fr]">
          <div className="max-w-sm">
            <p className="font-display text-2xl tracking-tight text-foreground">
              {siteConfig.name}
            </p>
            <p className="mt-3 text-body-sm leading-relaxed text-foreground-muted">
              {siteConfig.description}
            </p>

            <div className="mt-7">
              <p className="text-eyebrow text-foreground uppercase">Join the list</p>
              <p className="mt-2 text-body-sm text-foreground-muted">
                Early access to new arrivals, plus 10% off your first order.
              </p>
              <NewsletterForm className="mt-4" />
            </div>
          </div>

          <nav aria-label="Footer" className="grid grid-cols-2 gap-8 sm:grid-cols-4">
            {footerNav.map((group) => {
              const items = group.items.filter((item) => isResolvable(item.href, availablePages));

              // A heading with nothing under it reads as a rendering failure.
              if (items.length === 0) return null;

              return (
                <div key={group.title}>
                  <h2 className="text-eyebrow text-foreground uppercase">{group.title}</h2>
                  {/*
                   * `min-h-6` on each link, with the gap absorbed into the link
                   * box rather than sitting between two 17px targets. Footer links
                   * are standalone controls, so WCAG 2.5.8's inline-text exemption
                   * does not cover them.
                   */}
                  <ul className="mt-3 space-y-0.5">
                    {items.map((item) => (
                      <li key={item.href}>
                        <Link
                          href={item.href}
                          className="inline-flex min-h-6 items-center rounded-sm py-1 text-body-sm text-foreground-muted transition-colors duration-(--duration-fast) hover:text-accent-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-ring)"
                        >
                          {item.label}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </nav>
        </div>

        <div className="flex flex-col gap-6 border-t border-border py-8 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <span className="sr-only">Accepted payment methods</span>
            {PAYMENT_METHODS.map((method) => (
              <span
                key={method}
                className="rounded-md border border-border bg-surface px-2.5 py-1.5 text-[0.6875rem] font-semibold tracking-wide text-foreground-muted"
              >
                {method}
              </span>
            ))}
          </div>

          <ul className="flex flex-wrap gap-5">
            {Object.entries(siteConfig.social).map(([platform, href]) => (
              <li key={platform}>
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-6 items-center rounded-sm text-body-sm text-foreground-muted capitalize transition-colors hover:text-accent-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-ring)"
                >
                  {platform}
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
              </li>
            ))}
          </ul>
        </div>

        <div className="flex flex-col gap-3 border-t border-border py-7 text-xs text-foreground-subtle sm:flex-row sm:items-center sm:justify-between">
          <p>
            &copy; {new Date().getFullYear()} {siteConfig.legalName}. All rights reserved.
          </p>
          <p>
            You must be {siteConfig.minimumAge} or older to purchase.
            {/* Same rule as the nav links above: shown only if it resolves. */}
            {isResolvable(ROUTES.page('accessibility'), availablePages) ? (
              <>
                {' '}
                <Link
                  href={ROUTES.page('accessibility')}
                  className="underline underline-offset-4 hover:text-foreground"
                >
                  Accessibility
                </Link>
              </>
            ) : null}
          </p>
        </div>
      </Container>
    </footer>
  );
}
