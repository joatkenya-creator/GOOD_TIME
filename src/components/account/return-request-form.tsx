'use client';

import { useState, useTransition } from 'react';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Modal } from '@/components/ui/modal';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import { RETURN_REASONS } from '@/features/account/schemas';
import { requestReturnAction } from '@/server/actions/wishlist';
import { formatPrice } from '@/utils/format';

/**
 * Filing a return.
 *
 * Per-item rather than per-order: someone who bought three things and wants to
 * send one back should not have to explain the other two. Quantities are capped
 * at what is still returnable, which the server recomputes — a customer editing
 * the number in dev tools gets a rejection, not a refund.
 */

export interface ReturnableItem {
  id: string;
  productName: string;
  variantName: string;
  quantity: number;
  /** What is left after any earlier return against this line. */
  returnable: number;
  unitPriceCents: number;
}

export function ReturnRequestForm({
  orderId,
  orderNumber,
  items,
}: {
  orderId: string;
  orderNumber: string;
  items: ReturnableItem[];
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Record<string, number>>({});
  const [reason, setReason] = useState('');
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  const returnable = items.filter((item) => item.returnable > 0);
  const chosen = Object.entries(selected).filter(([, quantity]) => quantity > 0);

  const refundEstimate = chosen.reduce((total, [itemId, quantity]) => {
    const item = items.find((entry) => entry.id === itemId);
    return total + (item ? item.unitPriceCents * quantity : 0);
  }, 0);

  function toggle(item: ReturnableItem, checked: boolean) {
    setSelected((current) => {
      const next = { ...current };
      if (checked) next[item.id] = item.returnable;
      else delete next[item.id];
      return next;
    });
  }

  function submit() {
    setError(null);

    if (chosen.length === 0) {
      setError('Choose at least one item to return.');
      return;
    }
    if (!reason) {
      setError('Tell us why you are sending it back.');
      return;
    }

    startTransition(async () => {
      const result = await requestReturnAction({
        orderId,
        reason,
        comment,
        items: chosen.map(([orderItemId, quantity]) => ({ orderItemId, quantity })),
      });

      if (!result.ok) {
        setError(result.message);
        return;
      }

      toast({ variant: 'success', title: result.message });
      setOpen(false);
      setSelected({});
      setReason('');
      setComment('');
    });
  }

  if (returnable.length === 0) return null;

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Request a return
      </Button>

      <Modal open={open} onClose={() => setOpen(false)} title={`Return items from ${orderNumber}`}>
        <div className="space-y-5">
          <fieldset>
            <legend className="text-body-sm font-medium text-foreground">
              What are you sending back?
            </legend>

            <ul className="mt-3 space-y-2">
              {returnable.map((item) => (
                <li key={item.id} className="rounded-xl border border-border p-3">
                  <label className="flex min-h-11 cursor-pointer items-start gap-3">
                    <Checkbox
                      className="mt-0.5"
                      checked={selected[item.id] !== undefined}
                      onChange={(event) => toggle(item, event.target.checked)}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-body-sm font-medium text-foreground">
                        {item.productName}
                      </span>
                      <span className="text-body-xs block text-foreground-subtle">
                        {item.variantName} · {formatPrice(item.unitPriceCents)} each
                        {item.returnable < item.quantity
                          ? ` · ${item.returnable} of ${item.quantity} still returnable`
                          : ''}
                      </span>
                    </span>
                  </label>

                  {selected[item.id] !== undefined && item.returnable > 1 ? (
                    <div className="mt-2 pl-8">
                      <label
                        htmlFor={`qty-${item.id}`}
                        className="text-body-xs mb-1 block text-foreground-muted"
                      >
                        How many?
                      </label>
                      <Select
                        id={`qty-${item.id}`}
                        value={String(selected[item.id])}
                        onChange={(event) =>
                          setSelected((current) => ({
                            ...current,
                            [item.id]: Number(event.target.value),
                          }))
                        }
                        className="w-24"
                      >
                        {Array.from({ length: item.returnable }, (_, index) => index + 1).map(
                          (quantity) => (
                            <option key={quantity} value={quantity}>
                              {quantity}
                            </option>
                          ),
                        )}
                      </Select>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          </fieldset>

          <div>
            <label
              htmlFor="return-reason"
              className="mb-1.5 block text-body-sm font-medium text-foreground"
            >
              Why are you returning it?
            </label>
            <Select
              id="return-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            >
              <option value="">Choose a reason</option>
              {RETURN_REASONS.map((entry) => (
                <option key={entry.key} value={entry.key}>
                  {entry.label}
                </option>
              ))}
            </Select>
          </div>

          <div>
            <label
              htmlFor="return-comment"
              className="mb-1.5 block text-body-sm font-medium text-foreground"
            >
              Anything else we should know?{' '}
              <span className="font-normal text-foreground-subtle">(optional)</span>
            </label>
            <Textarea
              id="return-comment"
              rows={3}
              maxLength={1000}
              value={comment}
              onChange={(event) => setComment(event.target.value)}
            />
          </div>

          {refundEstimate > 0 ? (
            <p className="rounded-lg bg-surface-muted p-3 text-body-sm text-foreground-muted">
              Estimated refund:{' '}
              <strong className="text-foreground">{formatPrice(refundEstimate)}</strong>. The final
              amount is confirmed once we have inspected the items.
            </p>
          ) : null}

          <Alert variant="info" title="Before you send anything">
            For hygiene reasons we can only accept items that are unopened and unused. Anything
            opened cannot be resold and cannot be refunded.
          </Alert>

          {error ? (
            <Alert variant="danger" role="alert">
              {error}
            </Alert>
          ) : null}

          <div className="flex flex-wrap gap-3">
            <Button onClick={submit} isLoading={pending}>
              Request return
            </Button>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
