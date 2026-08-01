'use client';

import { RotateCw } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { setCartCount } from '@/hooks/use-cart-count';
import { reorderAction } from '@/server/actions/wishlist';

/**
 * Reorder.
 *
 * The one action on an order page that changes something elsewhere, so it lives
 * in its own client island rather than turning the whole page into one.
 *
 * On success it pushes to the cart: someone who taps "buy it again" has decided,
 * and leaving them on the order page to find the bag themselves is a step that
 * earns nothing.
 */
export function OrderActions({ orderId }: { orderId: string }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const { toast } = useToast();

  function reorder() {
    startTransition(async () => {
      const result = await reorderAction(orderId);
      if (result.count !== undefined) setCartCount(result.count);

      toast({ variant: result.ok ? 'success' : 'error', title: result.message });
      if (result.ok) router.push('/cart');
    });
  }

  return (
    <Button onClick={reorder} isLoading={pending}>
      <RotateCw aria-hidden="true" className="size-4" />
      Buy it again
    </Button>
  );
}
