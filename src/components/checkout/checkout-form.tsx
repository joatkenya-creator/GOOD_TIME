'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowLeft, Lock, ShieldCheck, Truck } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { useForm, useWatch, type FieldPath } from 'react-hook-form';

import {
  AddressFields,
  CheckboxField,
  Field,
  FieldError,
} from '@/components/checkout/address-fields';
import { CHECKOUT_STEPS, CheckoutProgress, type CheckoutStep } from '@/components/checkout/checkout-progress';
import { PaymentStep } from '@/components/checkout/payment-step';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Radio } from '@/components/ui/radio';
import { Textarea } from '@/components/ui/textarea';
import { ROUTES } from '@/constants/routes';
import {
  checkoutSchema,
  type CheckoutFormValues,
  type CheckoutInput,
} from '@/features/checkout/schemas';
import { submitCheckoutAction } from '@/server/actions/checkout';
import type { ShippingOption } from '@/services/shipping.service';
import { formatPrice } from '@/utils/format';
import { cn } from '@/utils/cn';

/**
 * The checkout.
 *
 * One React Hook Form across four steps rather than four forms: the customer can
 * go back to Contact from Review without losing anything, and the final submit
 * sends one object that the server re-validates with the same Zod schema.
 *
 * Steps are client state, not routes. A route per step means the browser's back
 * button leaves checkout entirely from step one, and it means four round trips
 * through a flow where every extra second measurably costs orders.
 */
export function CheckoutForm({
  shippingOptions,
  defaultEmail,
  isSignedIn,
}: {
  shippingOptions: ShippingOption[];
  defaultEmail: string | null;
  isSignedIn: boolean;
}) {
  const [step, setStep] = useState<CheckoutStep>('Contact');
  const [furthest, setFurthest] = useState<CheckoutStep>('Contact');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [payment, setPayment] = useState<
    Extract<Awaited<ReturnType<typeof submitCheckoutAction>>, { ok: true }> | null
  >(null);

  const form = useForm<CheckoutFormValues, unknown, CheckoutInput>({
    resolver: zodResolver(checkoutSchema),
    mode: 'onBlur',
    defaultValues: {
      email: defaultEmail ?? '',
      subscribe: false,
      billingSameAsShipping: true,
      // Pre-selecting the cheapest option means the customer never has to make a
      // choice to move forward — they only have to make one to upgrade.
      shippingRateId: shippingOptions[0]?.id ?? '',
      saveAddress: isSignedIn,
    },
  });

  const { register, handleSubmit, formState, control, trigger, setValue } = form;

  // `useWatch` rather than `watch()`: the latter is a plain function that
  // re-reads on every render, which the React Compiler cannot memoize and so
  // bails out of optimising this whole component.
  const values = useWatch({ control });
  const billingSame = values.billingSameAsShipping;
  const selectedRateId = values.shippingRateId;

  function goTo(next: CheckoutStep) {
    setStep(next);
    if (CHECKOUT_STEPS.indexOf(next) > CHECKOUT_STEPS.indexOf(furthest)) setFurthest(next);
    // Move focus to the step heading, or a keyboard user is left at the bottom of
    // the previous step with no idea the page changed.
    requestAnimationFrame(() => document.getElementById('checkout-step-heading')?.focus());
  }

  /** Validates only the fields on the current step before advancing. */
  async function advance() {
    const fields: Record<CheckoutStep, FieldPath<CheckoutFormValues>[]> = {
      Contact: ['email'],
      Shipping: billingSame
        ? ['shippingAddress', 'shippingRateId']
        : ['shippingAddress', 'shippingRateId', 'billingAddress'],
      Payment: [],
      Review: [],
    };

    const valid = await trigger(fields[step]);
    if (!valid) return;

    goTo(CHECKOUT_STEPS[CHECKOUT_STEPS.indexOf(step) + 1]!);
  }

  const onSubmit = handleSubmit(async (values) => {
    setSubmitError(null);

    const result = await submitCheckoutAction(values);

    if (!result.ok) {
      setSubmitError(result.message);

      // Field errors from the server belong on the fields, not in a banner.
      for (const [path, messages] of Object.entries(result.fieldErrors ?? {})) {
        form.setError(path as never, { message: messages[0] });
      }
      return;
    }

    setPayment(result);
  });

  // Store credit covered the whole bill, so there was never a card form to show.
  // The order is already paid; send them to the confirmation.
  if (payment && payment.clientSecret === null) {
    return (
      <div className="space-y-4">
        <Alert variant="success" title="Paid in full with your store credit">
          Order <strong>{payment.orderNumber}</strong> is confirmed. Nothing was charged to a
          card.
        </Alert>

        <Button asChild size="lg">
          <Link href={`/order/${payment.orderNumber}?email=${encodeURIComponent(values.email ?? '')}`}>
            View your order
          </Link>
        </Button>
      </div>
    );
  }

  if (payment) {
    return (
      <PaymentStep
        clientSecret={payment.clientSecret!}
        orderNumber={payment.orderNumber}
        totals={payment.totals}
        email={values.email ?? ''}
        onBack={() => {
          setPayment(null);
          goTo('Review');
        }}
      />
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-8">
      <CheckoutProgress current={step} furthest={furthest} onNavigate={goTo} />

      <h2
        id="checkout-step-heading"
        tabIndex={-1}
        className="text-h4 font-semibold text-foreground outline-none"
      >
        {step === 'Contact' && 'How can we reach you?'}
        {step === 'Shipping' && 'Where is it going?'}
        {step === 'Payment' && 'How would you like to pay?'}
        {step === 'Review' && 'Check everything over'}
      </h2>

      {submitError ? (
        <Alert variant="danger" title="We could not start your order">
          {submitError}
        </Alert>
      ) : null}

      {/* Every step stays mounted and is hidden with `hidden`, so going back does
          not remount an input and lose an uncommitted value. */}
      <div hidden={step !== 'Contact'} className="space-y-5">
        <Field
          id="email"
          type="email"
          label="Email address"
          autoComplete="email"
          inputMode="email"
          hint="Your receipt and tracking go here. Nothing explicit in the subject line."
          error={formState.errors.email?.message}
          {...register('email')}
        />

        {!isSignedIn ? (
          <p className="text-body-sm text-foreground-muted">
            Checking out as a guest.{' '}
            <Link href={ROUTES.auth.signIn} className="font-medium text-accent-text underline">
              Sign in
            </Link>{' '}
            to use a saved address.
          </p>
        ) : null}

        <CheckboxField
          id="subscribe"
          label="Email me new arrivals and offers"
          {...register('subscribe')}
        />
      </div>

      <div hidden={step !== 'Shipping'} className="space-y-8">
        <fieldset>
          <legend className="mb-3 text-body font-semibold text-foreground">Shipping address</legend>
          <AddressFields
            prefix="shippingAddress"
            section="shipping"
            register={register}
            errors={formState.errors}
          />
        </fieldset>

        <fieldset>
          <legend className="mb-3 flex items-center gap-2 text-body font-semibold text-foreground">
            <Truck aria-hidden="true" className="size-4 text-foreground-subtle" />
            Delivery method
          </legend>

          {shippingOptions.length === 0 ? (
            <Alert variant="warning" title="No delivery options">
              We could not find a delivery method for this order. Contact us and we will sort it.
            </Alert>
          ) : (
            <div className="space-y-2">
              {shippingOptions.map((option) => (
                // The whole card is the label, so the tap target is the row
                // rather than the 18px dot.
                <label
                  key={option.id}
                  htmlFor={`rate-${option.id}`}
                  className={cn(
                    'flex cursor-pointer items-center gap-3 rounded-xl border p-4 transition-colors',
                    selectedRateId === option.id
                      ? 'border-accent bg-accent-subtle'
                      : 'border-border hover:border-foreground-subtle',
                  )}
                >
                  <Radio
                    id={`rate-${option.id}`}
                    value={option.id}
                    checked={selectedRateId === option.id}
                    onChange={() =>
                      setValue('shippingRateId', option.id, { shouldValidate: true })
                    }
                    name="shippingRateId"
                  />

                  <span className="flex flex-1 items-baseline justify-between gap-4">
                    <span>
                      <span className="block text-body-sm font-medium text-foreground">
                        {option.name}
                      </span>
                      <span className="block text-body-xs text-foreground-subtle">
                        {option.description ??
                          `Arrives in ${option.estimatedDaysMin}–${option.estimatedDaysMax} business days`}
                      </span>
                    </span>

                    <span className="shrink-0 text-body-sm font-medium tabular-nums text-foreground">
                      {option.priceCents === 0 ? 'Free' : formatPrice(option.priceCents)}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          )}

          <FieldError message={formState.errors.shippingRateId?.message} id="shippingRateId-error" />
        </fieldset>

        <fieldset>
          <CheckboxField
            id="billingSameAsShipping"
            label="Billing address is the same as shipping"
            {...register('billingSameAsShipping')}
          />

          {!billingSame ? (
            <div className="mt-5">
              <AddressFields
                prefix="billingAddress"
                section="billing"
                register={register}
                errors={formState.errors}
              />
            </div>
          ) : null}
        </fieldset>

        <div>
          <label
            htmlFor="customerNote"
            className="mb-1.5 block text-body-sm font-medium text-foreground"
          >
            Delivery instructions{' '}
            <span className="font-normal text-foreground-subtle">(optional)</span>
          </label>
          <Textarea
            id="customerNote"
            rows={2}
            maxLength={500}
            placeholder="Leave with the doorman, ring twice…"
            {...register('customerNote')}
          />
        </div>
      </div>

      <div hidden={step !== 'Payment'} className="space-y-5">
        <Alert variant="info" title="Your card is entered on the next screen">
          Card details are handled by Stripe and never touch our servers. Confirm your order below
          and the secure card form opens.
        </Alert>

        <div className="rounded-xl border border-border bg-surface-muted p-4">
          <h3 className="flex items-center gap-2 text-body-sm font-semibold text-foreground">
            <ShieldCheck aria-hidden="true" className="size-4 text-(--color-success)" />
            Discreet by default
          </h3>
          <ul className="mt-2 space-y-1 text-body-xs text-foreground-muted">
            <li>Your statement shows a neutral descriptor, not a product name.</li>
            <li>The box is plain, unbranded, and the sender name is generic.</li>
            <li>Nothing on the outside describes what is inside.</li>
          </ul>
        </div>
      </div>

      <div hidden={step !== 'Review'} className="space-y-5">
        <ReviewSummary values={values} options={shippingOptions} onEdit={goTo} />

        <CheckboxField
          id="ageConfirmed"
          label="I confirm I am 18 years of age or older."
          error={formState.errors.ageConfirmed?.message}
          {...register('ageConfirmed')}
        />

        <CheckboxField
          id="acceptTerms"
          label={
            <>
              I agree to the{' '}
              <Link href="/terms" className="underline">
                terms of sale
              </Link>{' '}
              and{' '}
              <Link href="/privacy" className="underline">
                privacy policy
              </Link>
              .
            </>
          }
          error={formState.errors.acceptTerms?.message}
          {...register('acceptTerms')}
        />
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-border pt-6">
        {step === 'Contact' ? (
          <Button asChild variant="ghost">
            <Link href={ROUTES.cart}>
              <ArrowLeft aria-hidden="true" className="size-4" />
              Back to bag
            </Link>
          </Button>
        ) : (
          <Button
            type="button"
            variant="ghost"
            onClick={() => goTo(CHECKOUT_STEPS[CHECKOUT_STEPS.indexOf(step) - 1]!)}
          >
            <ArrowLeft aria-hidden="true" className="size-4" />
            Back
          </Button>
        )}

        <div className="ml-auto">
          {step === 'Review' ? (
            <Button type="submit" size="lg" isLoading={formState.isSubmitting}>
              <Lock aria-hidden="true" className="size-4" />
              Continue to payment
            </Button>
          ) : (
            <Button type="button" size="lg" onClick={advance}>
              Continue
            </Button>
          )}
        </div>
      </div>
    </form>
  );
}

type ReviewValues = {
  email?: string;
  shippingRateId?: string;
  shippingAddress?: Partial<CheckoutFormValues['shippingAddress']>;
};

/** Read-back of everything entered, with a way to fix each part in place. */
function ReviewSummary({
  values,
  options,
  onEdit,
}: {
  /**
   * Whatever the form holds right now — every field optional, because a partly
   * filled form is exactly the state this has to render.
   */
  values: ReviewValues;
  options: ShippingOption[];
  onEdit: (step: CheckoutStep) => void;
}) {
  const address = values.shippingAddress;
  const method = options.find((option) => option.id === values.shippingRateId);

  return (
    <dl className="divide-y divide-border rounded-xl border border-border">
      <Block label="Contact" onEdit={() => onEdit('Contact')}>
        {values.email}
      </Block>

      <Block label="Ship to" onEdit={() => onEdit('Shipping')}>
        {address?.line1 ? (
          <>
            {address.firstName} {address.lastName}
            <br />
            {address.line1}
            {address.line2 ? (
              <>
                <br />
                {address.line2}
              </>
            ) : null}
            <br />
            {address.city}, {address.state} {address.postalCode}
          </>
        ) : (
          <span className="text-foreground-subtle">Not set</span>
        )}
      </Block>

      <Block label="Delivery" onEdit={() => onEdit('Shipping')}>
        {method ? (
          <>
            {method.name} —{' '}
            {method.priceCents === 0 ? 'Free' : formatPrice(method.priceCents)}
            <br />
            <span className="text-body-xs text-foreground-subtle">
              Arrives in {method.estimatedDaysMin}–{method.estimatedDaysMax} business days
            </span>
          </>
        ) : (
          <span className="text-foreground-subtle">Not chosen</span>
        )}
      </Block>
    </dl>
  );
}

function Block({
  label,
  children,
  onEdit,
}: {
  label: string;
  children: React.ReactNode;
  onEdit: () => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4 p-4">
      <div className="min-w-0">
        <dt className="text-body-xs font-medium tracking-wide text-foreground-subtle uppercase">
          {label}
        </dt>
        <dd className="mt-1 text-body-sm text-foreground">{children}</dd>
      </div>

      <button
        type="button"
        onClick={onEdit}
        className="shrink-0 rounded-md px-2 py-1 text-body-sm font-medium text-accent-text underline underline-offset-4 hover:text-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-ring)"
      >
        Edit<span className="sr-only"> {label}</span>
      </button>
    </div>
  );
}
