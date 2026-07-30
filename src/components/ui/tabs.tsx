'use client';

import { useId, useRef, useState } from 'react';

import { cn } from '@/utils/cn';

export interface TabItem {
  id: string;
  label: string;
  content: React.ReactNode;
}

export interface TabsProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'children'> {
  items: TabItem[];
  defaultTab?: string;
}

/**
 * Tabs implementing the WAI-ARIA tabs pattern.
 *
 * The details that matter and are usually missed: only the active tab is in the
 * tab order (roving `tabIndex`), arrow keys move between tabs, and Home/End jump
 * to the ends. Without those it is a row of buttons wearing tab roles.
 */
export function Tabs({ items, defaultTab, className, ...props }: TabsProps) {
  const baseId = useId();
  const [active, setActive] = useState(defaultTab ?? items[0]?.id);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const activeIndex = items.findIndex((item) => item.id === active);

  function focusTab(index: number) {
    const item = items[(index + items.length) % items.length];
    if (!item) return;
    setActive(item.id);
    tabRefs.current[item.id]?.focus();
  }

  function onKeyDown(event: React.KeyboardEvent) {
    const handlers: Record<string, () => void> = {
      ArrowRight: () => focusTab(activeIndex + 1),
      ArrowLeft: () => focusTab(activeIndex - 1),
      Home: () => focusTab(0),
      End: () => focusTab(items.length - 1),
    };

    const handler = handlers[event.key];
    if (!handler) return;
    event.preventDefault();
    handler();
  }

  return (
    <div className={className} {...props}>
      <div role="tablist" onKeyDown={onKeyDown} className="flex gap-1 border-b border-border">
        {items.map((item) => {
          const isActive = item.id === active;

          return (
            <button
              key={item.id}
              ref={(node) => {
                tabRefs.current[item.id] = node;
              }}
              type="button"
              role="tab"
              id={`${baseId}-tab-${item.id}`}
              aria-selected={isActive}
              aria-controls={`${baseId}-panel-${item.id}`}
              tabIndex={isActive ? 0 : -1}
              onClick={() => setActive(item.id)}
              className={cn(
                'relative -mb-px px-5 py-3 text-sm font-medium whitespace-nowrap',
                'transition-colors duration-(--duration-fast) ease-(--ease-brand)',
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-ring)',
                isActive
                  ? 'border-b-2 border-accent text-foreground'
                  : 'border-b-2 border-transparent text-foreground-muted hover:text-foreground',
              )}
            >
              {item.label}
            </button>
          );
        })}
      </div>

      {items.map((item) => (
        <div
          key={item.id}
          role="tabpanel"
          id={`${baseId}-panel-${item.id}`}
          aria-labelledby={`${baseId}-tab-${item.id}`}
          hidden={item.id !== active}
          tabIndex={0}
          className="pt-6 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-ring)"
        >
          {item.content}
        </div>
      ))}
    </div>
  );
}
