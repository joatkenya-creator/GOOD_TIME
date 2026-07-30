import { Plus } from 'lucide-react';

import { cn } from '@/utils/cn';

export interface AccordionItemProps extends React.DetailsHTMLAttributes<HTMLDetailsElement> {
  question: string;
  /** Groups items so opening one closes the others (native exclusive accordion). */
  group?: string;
}

/**
 * Accordion, built on native `<details>`/`<summary>`.
 *
 * The platform supplies the disclosure semantics, keyboard handling and
 * `aria-expanded` state for free — and content inside a closed `<details>` is
 * still found by in-page search. A JS accordion reimplements all of that and
 * usually gets one of them wrong.
 *
 * The `name` attribute makes a group behave exclusively without a line of JS.
 */
export function AccordionItem({
  question,
  group,
  className,
  children,
  ...props
}: AccordionItemProps) {
  return (
    <details name={group} className={cn('group border-b border-border', className)} {...props}>
      <summary
        className={cn(
          'flex cursor-pointer list-none items-center justify-between gap-6 py-5 text-left',
          'text-base font-medium text-foreground marker:hidden',
          'transition-colors duration-(--duration-fast) hover:text-accent-text',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-ring)',
          '[&::-webkit-details-marker]:hidden',
        )}
      >
        {question}
        <Plus
          aria-hidden="true"
          className="size-5 shrink-0 text-foreground-subtle transition-transform duration-(--duration-base) ease-(--ease-brand) group-open:rotate-45"
        />
      </summary>

      <div className="pb-6 text-body-sm leading-relaxed text-foreground-muted">{children}</div>
    </details>
  );
}

export function Accordion({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('border-t border-border', className)} {...props} />;
}
