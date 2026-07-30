/**
 * Design system barrel.
 *
 * Import from `@/components/ui` rather than reaching into individual files —
 * it keeps call sites short and makes a component rename a one-line change here.
 */
export { Accordion, AccordionItem, type AccordionItemProps } from '@/components/ui/accordion';
export { Alert, alertVariants, type AlertProps } from '@/components/ui/alert';
export { Badge, badgeVariants, type BadgeProps } from '@/components/ui/badge';
export { Button, buttonVariants, type ButtonProps } from '@/components/ui/button';
export { Carousel, type CarouselProps } from '@/components/ui/carousel';
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
export { Chip, type ChipProps } from '@/components/ui/chip';
export { Drawer, type DrawerProps } from '@/components/ui/drawer';
export { Dropdown, DropdownItem, type DropdownProps } from '@/components/ui/dropdown';
export { EmptyState, type EmptyStateProps } from '@/components/ui/empty-state';
export { Input, fieldVariants, type InputProps } from '@/components/ui/input';
export { Modal, type ModalProps } from '@/components/ui/modal';
export { Pagination, type PaginationProps } from '@/components/ui/pagination';
export { Price, type PriceProps } from '@/components/ui/price';
export { Radio, RadioGroup, type RadioGroupProps, type RadioProps } from '@/components/ui/radio';
export { Rating, type RatingProps } from '@/components/ui/rating';
export { Select, type SelectProps } from '@/components/ui/select';
export { Skeleton, SkeletonText, type SkeletonProps } from '@/components/ui/skeleton';
export { Spinner, type SpinnerProps } from '@/components/ui/spinner';
export { Tabs, type TabItem, type TabsProps } from '@/components/ui/tabs';
export { Textarea, type TextareaProps } from '@/components/ui/textarea';
export { ToastProvider, useToast } from '@/components/ui/toast';
export { Tooltip, type TooltipProps } from '@/components/ui/tooltip';
