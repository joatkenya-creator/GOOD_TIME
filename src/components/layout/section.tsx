import { Container, type ContainerProps } from '@/components/layout/container';
import { cn } from '@/utils/cn';

export interface SectionProps extends Omit<ContainerProps, 'as'> {
  /** Small uppercase label above the heading. */
  eyebrow?: string;
  title?: string;
  description?: string;
  /** Link or button aligned to the right of the heading on desktop. */
  action?: React.ReactNode;
  /** Vertical rhythm. `none` when the parent already provides spacing. */
  spacing?: 'none' | 'sm' | 'md' | 'lg';
}

const SPACING = {
  none: '',
  sm: 'py-10',
  md: 'py-(--spacing-section)',
  lg: 'py-20 sm:py-28',
} as const;

/**
 * Page section with an optional heading block.
 *
 * Centralising the eyebrow/title/description rhythm is what keeps a long
 * marketing page feeling like one design rather than six.
 */
export function Section({
  eyebrow,
  title,
  description,
  action,
  spacing = 'md',
  className,
  children,
  ...props
}: SectionProps) {
  const hasHeading = Boolean(eyebrow || title || description || action);

  return (
    <section className={cn(SPACING[spacing], className)}>
      <Container {...props}>
        {hasHeading ? (
          <div className="mb-10 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="max-w-2xl space-y-3">
              {eyebrow ? <p className="text-eyebrow text-accent uppercase">{eyebrow}</p> : null}
              {title ? <h2 className="text-display-md text-foreground">{title}</h2> : null}
              {description ? (
                <p className="text-base leading-relaxed text-foreground-muted">{description}</p>
              ) : null}
            </div>
            {action ? <div className="shrink-0">{action}</div> : null}
          </div>
        ) : null}

        {children}
      </Container>
    </section>
  );
}
