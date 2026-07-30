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
export function Footer() {
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
            {footerNav.map((group) => (
              <div key={group.title}>
                <h2 className="text-eyebrow text-foreground uppercase">{group.title}</h2>
                <ul className="mt-4 space-y-2.5">
                  {group.items.map((item) => (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        className="text-body-sm text-foreground-muted transition-colors duration-(--duration-fast) hover:text-accent-text"
                      >
                        {item.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
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
                  className="text-body-sm text-foreground-muted capitalize transition-colors hover:text-accent-text"
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
            You must be {siteConfig.minimumAge} or older to purchase.{' '}
            <Link
              href={ROUTES.page('accessibility')}
              className="underline underline-offset-4 hover:text-foreground"
            >
              Accessibility
            </Link>
          </p>
        </div>
      </Container>
    </footer>
  );
}
