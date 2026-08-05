import Link from 'next/link';

import { findNavItem } from '@/config/admin-nav';

/**
 * Every admin page starts with one of these.
 *
 * Title, breadcrumbs and the primary actions, in one place, so fifteen modules
 * cannot drift into fifteen slightly different headers. The breadcrumb trail is
 * derived from the route rather than passed in — a hand-written trail is one
 * more thing to forget to update when a page moves.
 */
export function AdminPageHeader({
  title,
  description,
  pathname,
  trail = [],
  actions,
}: {
  title: string;
  description?: string;
  /** The current route, for deriving the section crumb. */
  pathname: string;
  /** Extra crumbs beyond the section, e.g. a product name on its editor. */
  trail?: { label: string; href?: string }[];
  actions?: React.ReactNode;
}) {
  const section = findNavItem(pathname);
  const onSectionRoot = section?.href === pathname;

  return (
    <header className="mb-6">
      <nav aria-label="Breadcrumb" className="mb-3">
        <ol className="text-body-xs flex flex-wrap items-center gap-1.5 text-foreground-subtle">
          <li>
            <Link href="/admin" className="hover:text-foreground">
              Admin
            </Link>
          </li>

          {section && section.href !== '/admin' ? (
            <li className="flex items-center gap-1.5">
              <span aria-hidden="true">/</span>
              {onSectionRoot && trail.length === 0 ? (
                <span aria-current="page" className="text-foreground">
                  {section.label}
                </span>
              ) : (
                <Link href={section.href} className="hover:text-foreground">
                  {section.label}
                </Link>
              )}
            </li>
          ) : null}

          {trail.map((crumb, index) => {
            const last = index === trail.length - 1;
            return (
              <li key={`${crumb.label}-${index}`} className="flex items-center gap-1.5">
                <span aria-hidden="true">/</span>
                {crumb.href && !last ? (
                  <Link href={crumb.href} className="hover:text-foreground">
                    {crumb.label}
                  </Link>
                ) : (
                  <span
                    aria-current={last ? 'page' : undefined}
                    className={last ? 'text-foreground' : undefined}
                  >
                    {crumb.label}
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      </nav>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          {/*
            One `h1` per page, here. The shell owns `<main>`; pages own the
            heading. Splitting it any other way ends with two of one and none of
            the other.
          */}
          <h1 className="text-display-sm text-foreground">{title}</h1>
          {description ? (
            <p className="mt-1.5 max-w-2xl text-body-sm text-foreground-muted">{description}</p>
          ) : null}
        </div>

        {actions ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
        ) : null}
      </div>
    </header>
  );
}

/** A titled panel. The admin's only container, so the pages stay consistent. */
export function AdminCard({
  title,
  description,
  actions,
  children,
  className = '',
}: {
  title?: string;
  description?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-xl border border-border bg-surface ${className}`}>
      {title ? (
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-body font-semibold text-foreground">{title}</h2>
            {description ? (
              <p className="text-body-xs mt-0.5 text-foreground-subtle">{description}</p>
            ) : null}
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}

      <div className="p-5">{children}</div>
    </section>
  );
}
