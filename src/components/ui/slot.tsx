import { Children, cloneElement, isValidElement, type ReactElement } from 'react';

import { cn } from '@/utils/cn';

/**
 * Merges props onto a single child element instead of rendering a wrapper.
 *
 * This is the `asChild` primitive. Twelve lines here replaces a Radix dependency
 * we would otherwise pull in for this one behaviour.
 */
export function Slot({
  children,
  className,
  ...props
}: React.HTMLAttributes<HTMLElement> & { children?: React.ReactNode }) {
  const child = Children.only(children);

  if (!isValidElement(child)) return null;

  const childProps = child.props as React.HTMLAttributes<HTMLElement>;

  return cloneElement(child as ReactElement<React.HTMLAttributes<HTMLElement>>, {
    ...props,
    ...childProps,
    className: cn(className, childProps.className),
  });
}
