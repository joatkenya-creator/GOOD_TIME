import { ArrowRight, Clock, Gift, Heart, MapPin, Package, RotateCcw, Wallet } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { OrderSummaryCard } from '@/components/account/order-summary-card';
import { ProductRail } from '@/components/account/product-rail';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ROUTES } from '@/constants/routes';
import { requireUser } from '@/server/auth/session';
import { getDashboard, profileCompletion } from '@/services/account/profile.service';
import {
  TIER_LABELS,
  getRewardAccount,
  grantBirthdayIfDue,
} from '@/services/account/rewards.service';
import { continueShopping, recommendedForCustomer } from '@/services/recommendation.service';
import { formatPrice } from '@/utils/format';

export const metadata: Metadata = { title: 'Dashboard' };

/**
 * The account dashboard.
 *
 * Answers the questions someone actually signs in to ask — where is my order,
 * what did I save, what is owed to me — before anything else. Rewards and
 * recommendations come after, because nobody signs in to look at a points
 * balance.
 *
 * A server component throughout; the only client code is inside the rails'
 * buttons. The reads are independent, so they run together rather than turning a
 * dashboard into nine sequential round trips the customer watches.
 */
export default async function AccountDashboardPage() {
  const user = await requireUser();

  // Checked on arrival rather than swept nightly: a reward nobody has come back
  // to collect costs nothing to delay, and a nightly job over every customer
  // costs something every night. Awaited before the balances are read so a grant
  // shows up the moment it is made.
  await grantBirthdayIfDue(user.id);

  const [data, rewards, recommendations, keepShopping] = await Promise.all([
    getDashboard(user.id),
    getRewardAccount(user.id),
    recommendedForCustomer(user.id, 8),
    continueShopping(user.id, 8),
  ]);

  const completion = profileCompletion({
    firstName: data.profile?.firstName ?? null,
    lastName: data.profile?.lastName ?? null,
    phone: data.profile?.phone ?? null,
    emailVerified: data.profile?.emailVerified ?? null,
    addressCount: data.addresses.length,
  });

  const firstName = data.profile?.firstName;

  return (
    <div className="space-y-10">
      <header>
        <h1 className="text-h2 font-bold text-foreground">
          {firstName ? `Welcome back, ${firstName}` : 'Your account'}
        </h1>
        <p className="mt-1 text-body-sm text-foreground-muted">
          {data.orderCount > 0
            ? `${data.orderCount} ${data.orderCount === 1 ? 'order' : 'orders'} · member since ${data.profile?.createdAt.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`
            : 'Everything about your account lives here.'}
        </p>
      </header>

      {/* Shown only while there is something left to finish. A progress bar that
          never reaches 100% is nagging, not helping. */}
      {completion.missing.length > 0 ? (
        <section
          aria-labelledby="complete-profile"
          className="rounded-2xl border border-accent/30 bg-accent-subtle p-5"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="complete-profile" className="text-body font-semibold text-foreground">
              Finish setting up your account
            </h2>
            <span className="text-body-sm font-medium text-accent-text">
              {completion.percent}% complete
            </span>
          </div>

          <div
            role="progressbar"
            aria-valuenow={completion.percent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-labelledby="complete-profile"
            className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface"
          >
            <div
              className="h-full rounded-full bg-accent transition-[width]"
              style={{ width: `${completion.percent}%` }}
            />
          </div>

          <ul className="mt-4 flex flex-wrap gap-2">
            {completion.missing.map((step) => (
              <li key={step.href + step.label}>
                <Link
                  href={step.href}
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-accent/40 bg-surface px-4 text-body-sm font-medium text-accent-text hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-ring)"
                >
                  {step.label}
                  <ArrowRight aria-hidden="true" className="size-3.5" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="at-a-glance">
        <h2 id="at-a-glance" className="sr-only">
          Account summary
        </h2>

        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          <StatTile
            href={ROUTES.account.orders}
            icon={<Package aria-hidden="true" className="size-4" />}
            label="Orders"
            value={String(data.orderCount)}
            detail={
              data.lifetimeSpendCents > 0
                ? `${formatPrice(data.lifetimeSpendCents)} lifetime`
                : 'No orders yet'
            }
          />
          <StatTile
            href={ROUTES.account.wishlist}
            icon={<Heart aria-hidden="true" className="size-4" />}
            label="Wishlist"
            value={String(data.wishlistCount)}
            detail={data.wishlistCount === 1 ? 'item saved' : 'items saved'}
          />
          <StatTile
            href="/account/rewards"
            icon={<Gift aria-hidden="true" className="size-4" />}
            label="Points"
            value={String(rewards.pointsBalance)}
            detail={TIER_LABELS[rewards.tier]}
          />
          <StatTile
            href="/account/rewards"
            icon={<Wallet aria-hidden="true" className="size-4" />}
            label="Store credit"
            value={formatPrice(rewards.storeCreditCents)}
            detail={rewards.storeCreditCents > 0 ? 'Applied at checkout' : 'None yet'}
          />
        </div>
      </section>

      <section aria-labelledby="recent-orders">
        <div className="flex items-baseline justify-between gap-4">
          <h2 id="recent-orders" className="text-h5 font-semibold text-foreground">
            Recent orders
          </h2>
          {data.orderCount > 3 ? (
            <Link
              href={ROUTES.account.orders}
              className="text-body-sm font-medium text-accent-text underline underline-offset-4"
            >
              View all
            </Link>
          ) : null}
        </div>

        {data.recentOrders.length === 0 ? (
          <EmptyPanel
            icon={<Package aria-hidden="true" className="size-6" />}
            title="No orders yet"
            description="When you order something it will show up here, with tracking."
            action={{ href: ROUTES.shop, label: 'Start shopping' }}
          />
        ) : (
          <ul className="mt-4 space-y-3">
            {data.recentOrders.map((order) => (
              <li key={order.id}>
                <OrderSummaryCard order={order} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {data.openReturns > 0 ? (
        <section className="rounded-2xl border border-border bg-surface p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="flex items-center gap-2 text-body-sm text-foreground">
              <RotateCcw aria-hidden="true" className="size-4 text-foreground-subtle" />
              You have {data.openReturns} return{data.openReturns === 1 ? '' : 's'} in progress.
            </p>
            <Button asChild variant="secondary" size="sm">
              <Link href="/account/returns">Track returns</Link>
            </Button>
          </div>
        </section>
      ) : null}

      <section aria-labelledby="saved-addresses">
        <div className="flex items-baseline justify-between gap-4">
          <h2 id="saved-addresses" className="text-h5 font-semibold text-foreground">
            Saved addresses
          </h2>
          <Link
            href={ROUTES.account.addresses}
            className="text-body-sm font-medium text-accent-text underline underline-offset-4"
          >
            Manage
          </Link>
        </div>

        {data.addresses.length === 0 ? (
          <EmptyPanel
            icon={<MapPin aria-hidden="true" className="size-6" />}
            title="No saved addresses"
            description="Save one and checkout fills itself in next time."
            action={{ href: ROUTES.account.addresses, label: 'Add an address' }}
          />
        ) : (
          <ul className="mt-4 grid gap-3 sm:grid-cols-2">
            {data.addresses.map((address) => (
              <li key={address.id} className="rounded-xl border border-border bg-surface p-4">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-body-sm font-medium text-foreground">
                    {address.firstName} {address.lastName}
                  </p>
                  {address.isDefault ? <Badge variant="success">Default</Badge> : null}
                </div>
                <p className="mt-1 text-body-sm text-foreground-muted">
                  {address.line1}
                  {address.line2 ? `, ${address.line2}` : ''}
                  <br />
                  {address.city}, {address.state} {address.postalCode}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {keepShopping.length > 0 ? (
        <ProductRail
          title="Pick up where you left off"
          icon={<Clock aria-hidden="true" className="size-4" />}
          products={keepShopping}
          viewAllHref="/account/recently-viewed"
        />
      ) : null}

      {recommendations.items.length > 0 ? (
        <ProductRail title={recommendations.basis} products={recommendations.items} />
      ) : null}
    </div>
  );
}

function StatTile({
  href,
  icon,
  label,
  value,
  detail,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <Link
      href={href}
      className="block rounded-xl border border-border bg-surface p-4 transition-colors hover:border-foreground-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-ring)"
    >
      <span className="flex items-center gap-1.5 text-body-xs font-medium tracking-wide text-foreground-subtle uppercase">
        {icon}
        {label}
      </span>
      <p className="mt-2 text-h4 font-bold tabular-nums text-foreground">{value}</p>
      <p className="text-body-xs text-foreground-subtle">{detail}</p>
    </Link>
  );
}

function EmptyPanel({
  icon,
  title,
  description,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  action: { href: string; label: string };
}) {
  return (
    <div className="mt-4 rounded-2xl border border-dashed border-border p-8 text-center">
      <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-surface-muted text-foreground-subtle">
        {icon}
      </span>
      <p className="mt-3 text-body font-medium text-foreground">{title}</p>
      <p className="mt-1 text-body-sm text-foreground-muted">{description}</p>
      <Button asChild variant="secondary" className="mt-4">
        <Link href={action.href}>{action.label}</Link>
      </Button>
    </div>
  );
}
