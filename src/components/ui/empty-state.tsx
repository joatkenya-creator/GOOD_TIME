import { cn } from '@/utils/cn';

export interface EmptyStateProps extends React.HTMLAttributes<HTMLDivElement> {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  /** Primary recovery action. An empty state without one is a dead end. */
  action?: React.ReactNode;
}

/**
 * Empty state — no results, empty cart, no orders yet.
 *
 * Always pairs the "nothing here" message with a way out; that is the whole point
 * of the component, and the reason it takes an `action` rather than leaving it to
 * each call site to remember.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
  ...props
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-xl border border-dashed border-border px-6 py-16 text-center',
        className,
      )}
      {...props}
    >
      {icon ? (
        <div
          aria-hidden="true"
          className="mb-5 flex size-14 items-center justify-center rounded-full bg-accent-soft text-accent [&_svg]:size-6"
        >
          {icon}
        </div>
      ) : null}

      <p className="font-display text-xl tracking-tight text-foreground">{title}</p>

      {description ? (
        <p className="mt-2 max-w-sm text-sm leading-relaxed text-foreground-muted">{description}</p>
      ) : null}

      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  );
}
