import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/utils/cn';

const alertVariants = cva('flex gap-3 rounded-lg border p-4 text-sm', {
  variants: {
    variant: {
      info: 'border-info-500/20 bg-info-50 text-info-700',
      success: 'border-success-500/20 bg-success-50 text-success-700',
      warning: 'border-warning-500/20 bg-warning-50 text-warning-700',
      danger: 'border-danger-500/20 bg-danger-50 text-danger-700',
    },
  },
  defaultVariants: { variant: 'info' },
});

const ICONS = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: XCircle,
} as const;

export interface AlertProps
  extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof alertVariants> {
  title?: string;
  /** Hide the leading icon for dense layouts such as inline form errors. */
  hideIcon?: boolean;
}

/**
 * Alert.
 *
 * `role="alert"` on the danger variant makes screen readers announce it
 * immediately — which is what you want for a failed payment, and not what you
 * want for a passive tip.
 */
export function Alert({
  className,
  variant = 'info',
  title,
  hideIcon = false,
  children,
  ...props
}: AlertProps) {
  const Icon = ICONS[variant ?? 'info'];

  return (
    <div
      role={variant === 'danger' ? 'alert' : 'status'}
      className={cn(alertVariants({ variant }), className)}
      {...props}
    >
      {hideIcon ? null : <Icon aria-hidden="true" className="mt-0.5 size-4.5 shrink-0" />}
      <div className="space-y-1">
        {title ? <p className="font-semibold">{title}</p> : null}
        {/*
          No opacity on the body.

          It used to carry `opacity-90`, which reads as gentle de-emphasis and
          computes as a contrast cut: warning text at #C2410C is 5.18:1 on its
          surface, and the same colour at 90% blends to #C85322 — 4.09:1, under
          AA. The hierarchy is already carried by the semibold title, so the
          opacity bought nothing and cost the one thing an alert cannot spend.
        */}
        {children ? <div className="leading-relaxed">{children}</div> : null}
      </div>
    </div>
  );
}

export { alertVariants };
