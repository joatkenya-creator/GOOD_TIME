/**
 * Cache tag vocabulary.
 *
 * Next's data cache is invalidated by tag. Declaring every tag here means a
 * mutation can revalidate precisely what it touched — `revalidateTag(tags.product(id))`
 * instead of `revalidatePath('/', 'layout')`, which nukes the entire cache and
 * hands every visitor a cold render.
 */
export const tags = {
  products: 'products',
  product: (id: string) => `product:${id}`,
  productBySlug: (slug: string) => `product:slug:${slug}`,

  categories: 'categories',
  category: (id: string) => `category:${id}`,

  collections: 'collections',
  collection: (id: string) => `collection:${id}`,

  brands: 'brands',
  brand: (id: string) => `brand:${id}`,

  reviews: (productId: string) => `reviews:${productId}`,
  inventory: (variantId: string) => `inventory:${variantId}`,

  posts: 'posts',
  post: (slug: string) => `post:${slug}`,
  pages: 'pages',
  page: (slug: string) => `page:${slug}`,

  settings: 'settings',
  sitemap: 'sitemap',
} as const;

/** Tags to bust when a product changes. Listing pages and sitemaps go stale too. */
export function productTags(productId: string, slug: string): string[] {
  return [tags.products, tags.product(productId), tags.productBySlug(slug), tags.sitemap];
}
