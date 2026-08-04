import type { Metadata } from 'next';

import { AdminPageHeader } from '@/components/admin/page-header';
import { ProductEditor } from '@/components/admin/product-editor';
import { PERMISSIONS } from '@/constants/permissions';
import { createProductAction } from '@/server/actions/admin/products';
import { requireAdminPermission } from '@/server/auth/admin';
import { getProductFormOptions } from '@/services/admin/product-admin.service';

export const metadata: Metadata = { title: 'New product' };

export default async function NewProductPage() {
  await requireAdminPermission(PERMISSIONS.productWrite);
  const options = await getProductFormOptions();

  return (
    <>
      <AdminPageHeader
        title="New product"
        description="It starts as a draft. Nothing is visible on the storefront until you publish."
        pathname="/admin/products"
        trail={[{ label: 'New' }]}
      />

      <ProductEditor
        action={createProductAction}
        categories={options.categories}
        collections={options.collections.map((collection) => ({
          id: collection.id,
          name: collection.title,
        }))}
        brands={options.brands}
        values={{
          name: '',
          slug: '',
          subtitle: '',
          shortDescription: '',
          description: '',
          status: 'DRAFT',
          publishedAt: '',
          sku: '',
          barcode: '',
          brandId: '',
          isFeatured: false,
          // Every listing in this catalogue is age-restricted; defaulting it off
          // would mean one forgotten checkbox puts an unrestricted listing live.
          isAdultOnly: true,
          categoryIds: [],
          collectionIds: [],
          seoTitle: '',
          seoDescription: '',
          seoCanonical: '',
          seoNoindex: false,
        }}
      />
    </>
  );
}
