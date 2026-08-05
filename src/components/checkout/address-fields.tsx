'use client';

import type { FieldErrors, UseFormRegister } from 'react-hook-form';

import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { US_STATES } from '@/features/checkout/schemas';
import type { CheckoutFormValues } from '@/features/checkout/schemas';

/**
 * A US address block.
 *
 * The `autoComplete` tokens are not decoration: with the right ones the browser
 * fills the whole block from one tap, which is the difference between a
 * 40-second checkout and a 4-second one on a phone. `section-shipping` /
 * `section-billing` scope them so a browser does not overwrite one with the
 * other.
 */
export function AddressFields({
  prefix,
  register,
  errors,
  section,
}: {
  prefix: 'shippingAddress' | 'billingAddress';
  register: UseFormRegister<CheckoutFormValues>;
  errors: FieldErrors<CheckoutFormValues>;
  section: 'shipping' | 'billing';
}) {
  const fieldErrors = errors[prefix] as Record<string, { message?: string }> | undefined;
  const scope = `section-${section} ${section}`;
  const id = (name: string) => `${prefix}-${name}`;

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field
        id={id('firstName')}
        label="First name"
        error={fieldErrors?.firstName?.message}
        autoComplete={`${scope} given-name`}
        {...register(`${prefix}.firstName` as const)}
      />

      <Field
        id={id('lastName')}
        label="Last name"
        error={fieldErrors?.lastName?.message}
        autoComplete={`${scope} family-name`}
        {...register(`${prefix}.lastName` as const)}
      />

      <div className="sm:col-span-2">
        <Field
          id={id('line1')}
          label="Street address"
          error={fieldErrors?.line1?.message}
          autoComplete={`${scope} address-line1`}
          {...register(`${prefix}.line1` as const)}
        />
      </div>

      <div className="sm:col-span-2">
        <Field
          id={id('line2')}
          label="Apartment, suite, etc."
          optional
          error={fieldErrors?.line2?.message}
          autoComplete={`${scope} address-line2`}
          {...register(`${prefix}.line2` as const)}
        />
      </div>

      <Field
        id={id('city')}
        label="City"
        error={fieldErrors?.city?.message}
        autoComplete={`${scope} address-level2`}
        {...register(`${prefix}.city` as const)}
      />

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor={id('state')}>State</Label>
          <Select
            id={id('state')}
            defaultValue=""
            autoComplete={`${scope} address-level1`}
            aria-invalid={Boolean(fieldErrors?.state)}
            {...register(`${prefix}.state` as const)}
          >
            <option value="" disabled>
              Choose
            </option>
            {US_STATES.map(([code, name]) => (
              <option key={code} value={code}>
                {name}
              </option>
            ))}
          </Select>
          <FieldError message={fieldErrors?.state?.message} id={`${id('state')}-error`} />
        </div>

        <Field
          id={id('postalCode')}
          label="ZIP"
          inputMode="numeric"
          error={fieldErrors?.postalCode?.message}
          autoComplete={`${scope} postal-code`}
          {...register(`${prefix}.postalCode` as const)}
        />
      </div>

      <div className="sm:col-span-2">
        <Field
          id={id('phone')}
          label="Phone"
          optional
          type="tel"
          inputMode="tel"
          hint="Only used if there is a problem with your delivery."
          error={fieldErrors?.phone?.message}
          autoComplete={`${scope} tel`}
          {...register(`${prefix}.phone` as const)}
        />
      </div>
    </div>
  );
}

export function Label({ htmlFor, children }: { htmlFor: string; children: React.ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 block text-body-sm font-medium text-foreground">
      {children}
    </label>
  );
}

/**
 * Error slot for one field.
 *
 * The slot is always rendered, even when empty, because it sits above the
 * form's Continue button. Removing it when an error clears moved that button up
 * by 28px mid-click — the blur fired on mousedown, validation passed, the message
 * vanished, and the mouseup landed on nothing. Correcting a field and pressing
 * Continue did nothing at all, which is the kind of dead end people abandon a
 * checkout over. Reserving the line also keeps CLS at zero.
 */
export function FieldError({ message, id }: { message?: string; id: string }) {
  return (
    <p id={id} role="alert" className="text-body-xs mt-1 min-h-4 leading-4 text-(--color-error)">
      {message ?? ''}
    </p>
  );
}

/**
 * Label, input, hint and error as one unit.
 *
 * `aria-describedby` points at both the hint and the error, so a screen-reader
 * user hears the constraint *and* what went wrong — a bare `aria-invalid` tells
 * them something is broken without saying what.
 */
export const Field = function Field({
  id,
  label,
  error,
  hint,
  optional,
  ...props
}: {
  id: string;
  label: string;
  error?: string;
  hint?: string;
  optional?: boolean;
} & React.ComponentProps<typeof Input>) {
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-error` : null]
    .filter(Boolean)
    .join(' ');

  return (
    <div>
      <Label htmlFor={id}>
        {label}
        {optional ? (
          <span className="ml-1 font-normal text-foreground-subtle">(optional)</span>
        ) : null}
      </Label>

      <Input
        id={id}
        aria-invalid={Boolean(error)}
        {...(describedBy ? { 'aria-describedby': describedBy } : {})}
        {...props}
      />

      {hint ? (
        <p id={`${id}-hint`} className="text-body-xs mt-1 text-foreground-subtle">
          {hint}
        </p>
      ) : null}

      <FieldError message={error} id={`${id}-error`} />
    </div>
  );
};

/**
 * Checkbox with a label, a hit area and an error slot.
 *
 * The `ui/checkbox` primitive is a bare input by design. Everything in checkout
 * needs the label wired to it and a 44px row to tap, and repeating that markup
 * at six call sites is how one of them ends up without a `htmlFor`.
 */
export function CheckboxField({
  id,
  label,
  error,
  ...props
}: {
  id: string;
  label: React.ReactNode;
  error?: string;
} & React.ComponentProps<typeof Checkbox>) {
  return (
    <div>
      <label
        htmlFor={id}
        className="flex min-h-11 cursor-pointer items-start gap-3 py-1 text-body-sm text-foreground"
      >
        <Checkbox
          id={id}
          className="mt-0.5"
          aria-invalid={Boolean(error)}
          {...(error ? { 'aria-describedby': `${id}-error` } : {})}
          {...props}
        />
        <span>{label}</span>
      </label>

      <FieldError message={error} id={`${id}-error`} />
    </div>
  );
}
