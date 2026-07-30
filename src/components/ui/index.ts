/**
 * Design system barrel.
 *
 * Import from `@/components/ui` rather than reaching into individual files —
 * it keeps call sites short and makes a component rename a one-line change here.
 */
export { Alert, alertVariants, type AlertProps } from '@/components/ui/alert';
export { Badge, badgeVariants, type BadgeProps } from '@/components/ui/badge';
export { Button, buttonVariants, type ButtonProps } from '@/components/ui/button';
export {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  cardVariants,
  type CardProps,
} from '@/components/ui/card';
export { Checkbox, type CheckboxProps } from '@/components/ui/checkbox';
export { EmptyState, type EmptyStateProps } from '@/components/ui/empty-state';
export { Input, fieldVariants, type InputProps } from '@/components/ui/input';
export { Modal, type ModalProps } from '@/components/ui/modal';
export { Select, type SelectProps } from '@/components/ui/select';
export { Skeleton, SkeletonText, type SkeletonProps } from '@/components/ui/skeleton';
export { Spinner, type SpinnerProps } from '@/components/ui/spinner';
export { Textarea, type TextareaProps } from '@/components/ui/textarea';
