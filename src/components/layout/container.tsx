import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/utils/cn';

const containerVariants = cva('mx-auto w-full px-(--spacing-gutter) sm:px-8', {
  variants: {
    width: {
      /** Full site shell — grids, navigation, most pages. */
      shell: 'max-w-(--container-shell)',
      /** Comfortable reading measure — articles, policies, auth forms. */
      content: 'max-w-(--container-content)',
      narrow: 'max-w-xl',
      full: 'max-w-none',
    },
  },
  defaultVariants: { width: 'shell' },
});

export interface ContainerProps
  extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof containerVariants> {
  as?: 'div' | 'section' | 'main' | 'header' | 'footer' | 'article';
}

export function Container({ className, width, as: Component = 'div', ...props }: ContainerProps) {
  return <Component className={cn(containerVariants({ width }), className)} {...props} />;
}
