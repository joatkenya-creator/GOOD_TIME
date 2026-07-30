import { fieldVariants } from '@/components/ui/input';
import { cn } from '@/utils/cn';

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

export function Textarea({ className, 'aria-invalid': ariaInvalid, ...props }: TextareaProps) {
  return (
    <textarea
      className={cn(
        fieldVariants({ tone: ariaInvalid ? 'invalid' : 'default' }),
        'min-h-28 resize-y py-3 leading-relaxed',
        className,
      )}
      aria-invalid={ariaInvalid}
      {...props}
    />
  );
}
