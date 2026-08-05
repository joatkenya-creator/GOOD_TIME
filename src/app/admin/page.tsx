import type { Metadata } from 'next';
import Link from 'next/link';

import { AdminCard, AdminPageHeader } from '@/components/admin/page-header';
import { StatCard, Sparkline } from '@/components/admin/stat-card';
import { StatusPill } from '@/components/admin/data-table';
import { PERMISSIONS } from '@/constants/permissions';
import { formatMoney, formatRelative } from '@/features/admin/query';
import { requireAdminAccess } from '@/server/auth/admin';
import { can } from '@/server/auth/session';
import { listAudit } from '@/services/admin/audit.service';
import {
  getDashboardMetrics,
  getRecentOrders,
  getSalesTrend,
  getSystemHealth,
  getTopCategories,
  getTopProducts,
  percentChange,
} from '@/services/admin/dashboard.service';
import { ORDER_STATUS_TONE } from '@/features/admin/status';

export const metadata: Metadata = { title: 'Dashboard' };

/**
 * The executive dashboard.
 *
 * Everything on it is computed from the tables the storefront sells from. A
 * dashboard filled with plausible placeholder numbers is worse than an empty
 * one: an empty state says "no orders yet", invented figures say "$84,320" to
 * someone about to make a decision.
 *
 * All eight queries run concurrently — they are independent, and running them
 * in sequence would make the first screen of the admin the slowest.
 */
export default async function AdminDashboardPage() {
  /*
   * The home page of the admin asks only "are you staff".
   *
   * It used to require `analytics:read`, which customer support and content
   * editors do not hold — so the admin had no reachable home for them, and
   * every "go back to the dashboard" was a dead end. The panels below gate
   * themselves instead, which is the same rule applied one level finer.
   */
  const user = await requireAdminAccess();
  const seeMetrics = can(user, PERMISSIONS.analyticsRead);

  const empty = { items: [] as Awaited<ReturnType<typeof listAudit>>['items'] };

  const [metrics, trend, topProducts, topCategories, recentOrders, health, activity] =
    await Promise.all([
      getDashboardMetrics(),
      seeMetrics ? getSalesTrend(30) : Promise.resolve([]),
      seeMetrics ? getTopProducts(5) : Promise.resolve([]),
      seeMetrics ? getTopCategories(5) : Promise.resolve([]),
      can(user, PERMISSIONS.orderRead) ? getRecentOrders(6) : Promise.resolve([]),
      getSystemHealth(),
      can(user, PERMISSIONS.auditRead) ? listAudit({ pageSize: 8 }) : Promise.resolve(empty),
    ]);

  const quickActions = [
    { label: 'New product', href: '/admin/products/new', permission: PERMISSIONS.productWrite },
    {
      label: 'Orders to fulfil',
      href: '/admin/orders?status=PAID',
      permission: PERMISSIONS.orderRead,
    },
    {
      label: 'Low stock',
      href: '/admin/inventory?status=low',
      permission: PERMISSIONS.inventoryRead,
    },
  ].filter((action) => can(user, action.permission));

  return (
    <>
      <AdminPageHeader
        title="Dashboard"
        description="The last thirty days, against the thirty before them."
        pathname="/admin"
        actions={quickActions.map((action) => (
          <Link
            key={action.href}
            href={action.href}
            className="rounded-lg border border-border bg-surface px-3 py-2 text-body-sm font-medium hover:bg-surface-muted"
          >
            {action.label}
          </Link>
        ))}
      />

      {seeMetrics ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Revenue, 30 days"
            value={formatMoney(metrics.revenue30)}
            changePercent={percentChange(metrics.revenue30, metrics.revenuePrevious30)}
            hint="vs previous 30"
            href="/admin/reports"
          />
          <StatCard
            label="Orders, 30 days"
            value={String(metrics.orders30)}
            changePercent={percentChange(metrics.orders30, metrics.ordersPrevious30)}
            hint="vs previous 30"
            href="/admin/orders"
          />
          <StatCard
            label="Orders today"
            value={String(metrics.ordersToday)}
            hint={formatMoney(metrics.revenueToday)}
            changePercent={null}
            href="/admin/orders"
          />
          <StatCard
            label="New customers, 30 days"
            value={String(metrics.customers30)}
            changePercent={percentChange(metrics.customers30, metrics.customersPrevious30)}
            hint="vs previous 30"
            href="/admin/customers"
          />
        </div>
      ) : null}

      {/* Things that need a human. Kept above the charts on purpose. */}
      <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Pending orders"
          value={String(metrics.pendingOrders)}
          changePercent={null}
          href="/admin/orders?status=PENDING"
          invertTrend
        />
        <StatCard
          label="Refund requests"
          value={String(metrics.refundRequests)}
          changePercent={null}
          href="/admin/reports?report=returns"
          invertTrend
        />
        <StatCard
          label="Low stock"
          value={String(metrics.lowStock)}
          changePercent={null}
          href="/admin/inventory?status=low"
          invertTrend
        />
        <StatCard
          label="Out of stock"
          value={String(metrics.outOfStock)}
          changePercent={null}
          href="/admin/inventory?status=out"
          invertTrend
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        {seeMetrics ? (
          <AdminCard title="Revenue" description="Daily, last 30 days" className="lg:col-span-2">
            <Sparkline
              label="Daily revenue over the last 30 days"
              points={trend.map((day) => ({ date: day.date, value: day.revenueCents }))}
              formatValue={(value) => formatMoney(value)}
            />
          </AdminCard>
        ) : null}

        <AdminCard title="System health" description="What is observable from here">
          <dl className="space-y-3 text-body-sm">
            <HealthRow
              label="Database"
              value={`${health.databaseLatencyMs} ms`}
              tone={health.databaseLatencyMs < 500 ? 'success' : 'warning'}
            />
            <HealthRow
              label="Payments"
              value={health.klarnaConfigured ? 'Klarna connected' : 'Not configured'}
              tone={health.klarnaConfigured ? 'success' : 'warning'}
            />
            <HealthRow
              label="Email"
              value={health.emailConfigured ? 'Resend connected' : 'Not configured'}
              tone={health.emailConfigured ? 'success' : 'warning'}
            />
            <HealthRow
              label="Tax"
              value={health.taxProviderConfigured ? 'TaxJar connected' : 'Estimated rates'}
              tone={health.taxProviderConfigured ? 'success' : 'warning'}
            />
            <HealthRow
              label="Stuck checkouts"
              value={String(health.stuckPending)}
              tone={health.stuckPending === 0 ? 'success' : 'warning'}
            />
            <HealthRow
              label="Failed payments, 7 days"
              value={String(health.failedPayments)}
              tone={health.failedPayments === 0 ? 'success' : 'warning'}
            />
          </dl>
        </AdminCard>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {can(user, PERMISSIONS.orderRead) ? (
          <AdminCard
            title="Recent orders"
            actions={
              <Link
                href="/admin/orders"
                className="text-body-xs font-medium text-accent-text hover:underline"
              >
                View all
              </Link>
            }
          >
            {recentOrders.length === 0 ? (
              <p className="py-6 text-center text-body-sm text-foreground-subtle">No orders yet.</p>
            ) : (
              <ul className="divide-y divide-border">
                {recentOrders.map((order) => (
                  <li
                    key={order.id}
                    className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
                  >
                    <div className="min-w-0">
                      <Link
                        href={`/admin/orders/${order.orderNumber}`}
                        className="block truncate text-body-sm font-medium hover:text-accent-text"
                      >
                        {order.orderNumber}
                      </Link>
                      <p className="text-body-xs truncate text-foreground-subtle">
                        {[order.user?.firstName, order.user?.lastName].filter(Boolean).join(' ') ||
                          order.email}
                        {' · '}
                        {formatRelative(order.createdAt)}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <StatusPill label={order.status} tone={ORDER_STATUS_TONE[order.status]} />
                      <span className="text-body-sm font-medium tabular-nums">
                        {formatMoney(order.totalCents)}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </AdminCard>
        ) : null}

        {seeMetrics ? (
          <AdminCard title="Top products" description="By revenue, last 30 days">
            {topProducts.length === 0 ? (
              <p className="py-6 text-center text-body-sm text-foreground-subtle">
                Nothing sold in this window.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {topProducts.map((product) => (
                  <li
                    key={product.id}
                    className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
                  >
                    <div className="min-w-0">
                      <Link
                        href={`/admin/products/${product.id}`}
                        className="block truncate text-body-sm font-medium hover:text-accent-text"
                      >
                        {product.name}
                      </Link>
                      <p className="text-body-xs text-foreground-subtle">{product.units} sold</p>
                    </div>
                    <span className="shrink-0 text-body-sm font-medium tabular-nums">
                      {formatMoney(product.revenueCents)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </AdminCard>
        ) : null}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {seeMetrics ? (
          <AdminCard title="Top categories" description="By revenue, last 30 days">
            {topCategories.length === 0 ? (
              <p className="py-6 text-center text-body-sm text-foreground-subtle">
                Nothing sold in this window.
              </p>
            ) : (
              <ul className="space-y-3">
                {topCategories.map((category) => {
                  const share = Math.round(
                    (category.revenueCents / Math.max(1, topCategories[0]!.revenueCents)) * 100,
                  );

                  return (
                    <li key={category.name}>
                      <div className="flex items-baseline justify-between gap-3 text-body-sm">
                        <span className="truncate font-medium">{category.name}</span>
                        <span className="shrink-0 tabular-nums">
                          {formatMoney(category.revenueCents)}
                        </span>
                      </div>
                      {/*
                      A bar, not a pie. Comparing lengths on a shared baseline is
                      something people do accurately; comparing angles is not.
                    */}
                      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-surface-muted">
                        <div
                          className="h-full rounded-full bg-accent"
                          style={{ width: `${share}%` }}
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </AdminCard>
        ) : null}

        {can(user, PERMISSIONS.auditRead) ? (
          <AdminCard
            title="Recent activity"
            actions={
              <Link
                href="/admin/audit"
                className="text-body-xs font-medium text-accent-text hover:underline"
              >
                Full log
              </Link>
            }
          >
            {activity.items.length === 0 ? (
              <p className="py-6 text-center text-body-sm text-foreground-subtle">
                Nothing recorded yet.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {activity.items.map((entry) => (
                  <li key={entry.id} className="py-2.5 first:pt-0 last:pb-0">
                    <p className="text-body-sm">
                      <span className="font-medium">
                        {entry.actor?.firstName ?? entry.actor?.email ?? 'System'}
                      </span>{' '}
                      <span className="text-foreground-muted">
                        {entry.action.toLowerCase()}d {entry.entityType.toLowerCase()}
                      </span>
                    </p>
                    <p className="text-body-xs text-foreground-subtle">
                      {formatRelative(entry.createdAt)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </AdminCard>
        ) : null}
      </div>
    </>
  );
}

function HealthRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: 'success' | 'warning';
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-foreground-muted">{label}</dt>
      <dd>
        <StatusPill label={value} tone={tone} />
      </dd>
    </div>
  );
}
