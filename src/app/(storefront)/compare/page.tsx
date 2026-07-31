import type { Metadata } from 'next';

import { CompareTable } from '@/components/catalog/compare-table';
import { Container } from '@/components/layout/container';
import { buildMetadata } from '@/lib/seo/metadata';

/**
 * Product comparison.
 *
 * `noindex` and client-rendered: the selection lives in `localStorage`, so this
 * page is different for every visitor and there is nothing stable for a crawler
 * to index.
 */
export const metadata: Metadata = buildMetadata({
  title: 'Compare products',
  description: 'Compare specifications, materials and prices side by side.',
  path: '/compare',
  noindex: true,
});

export default function ComparePage() {
  return (
    <Container className="py-14">
      <h1 className="text-display-lg text-foreground">Compare</h1>
      <p className="mt-3 max-w-2xl text-body leading-relaxed text-foreground-muted">
        Up to four products, side by side. Rows where every product is identical are collapsed by
        default, so only the differences that matter are shown.
      </p>

      <CompareTable className="mt-10" />
    </Container>
  );
}
