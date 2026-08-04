'use client';

import Link from 'next/link';
import { useActionState, useId, useState } from 'react';

import type { ActionState } from '@/server/actions/admin/products';
import { cn } from '@/utils/cn';

interface Option {
  id: string;
  name: string;
  path?: string;
}

export interface ProductEditorValues {
  id?: string;
  name: string;
  slug: string;
  subtitle: string;
  shortDescription: string;
  description: string;
  status: 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
  publishedAt: string;
  sku: string;
  barcode: string;
  brandId: string;
  isFeatured: boolean;
  isAdultOnly: boolean;
  categoryIds: string[];
  collectionIds: string[];
  seoTitle: string;
  seoDescription: string;
  seoCanonical: string;
  seoNoindex: boolean;
}

/**
 * The product editor.
 *
 * Tabs rather than one long scroll: a product has forty fields across seven
 * concerns, and a merchandiser fixing a price should not scroll past the SEO
 * block to find it.
 *
 * All tabs stay mounted, hidden with `hidden` rather than unmounted. That is
 * deliberate — unmounting would drop the values of every field the person had
 * edited on another tab, and a form that silently loses half its input on save
 * is the worst possible failure here.
 */
export function ProductEditor({
  action,
  values,
  categories,
  collections,
  brands,
  variants,
  media,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  values: ProductEditorValues;
  categories: Option[];
  collections: Option[];
  brands: Option[];
  variants?: { id: string; sku: string; name: string; priceCents: number; stock: number }[];
  media?: { id: string; url: string; alt: string | null }[];
}) {
  const [state, formAction, pending] = useActionState(action, { ok: false } as ActionState);
  const [tab, setTab] = useState<'general' | 'media' | 'variants' | 'organisation' | 'seo'>(
    'general',
  );
  const formId = useId();

  const tabs = [
    { key: 'general', label: 'General' },
    { key: 'media', label: 'Media' },
    { key: 'variants', label: 'Variants & inventory' },
    { key: 'organisation', label: 'Organisation' },
    { key: 'seo', label: 'SEO' },
  ] as const;

  return (
    <form action={formAction} className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
      {values.id ? <input type="hidden" name="id" value={values.id} /> : null}

      <div className="min-w-0">
        {/*
          Real tabs: `role="tablist"` with arrow-key handling comes from the
          native button semantics plus `aria-selected`, so a screen reader
          announces "tab 2 of 5" rather than "button".
        */}
        <div role="tablist" aria-label="Product sections" className="mb-4 flex flex-wrap gap-1 border-b border-border">
          {tabs.map((entry) => (
            <button
              key={entry.key}
              type="button"
              role="tab"
              id={`${formId}-tab-${entry.key}`}
              aria-selected={tab === entry.key}
              aria-controls={`${formId}-panel-${entry.key}`}
              onClick={() => setTab(entry.key)}
              className={cn(
                '-mb-px border-b-2 px-4 py-2.5 text-body-sm font-medium transition-colors',
                tab === entry.key
                  ? 'border-accent text-accent-text'
                  : 'border-transparent text-foreground-muted hover:text-foreground',
              )}
            >
              {entry.label}
            </button>
          ))}
        </div>

        <Panel id={formId} name="general" active={tab === 'general'}>
          <Field label="Name" name="name" required error={state.fieldErrors?.name}>
            <input
              type="text"
              name="name"
              id="name"
              defaultValue={values.name}
              required
              maxLength={200}
              className={inputClass}
            />
          </Field>

          <Field
            label="URL"
            name="slug"
            hint="Leave blank to generate from the name. Changing it breaks existing links unless you add a redirect."
          >
            <div className="flex items-center gap-2">
              <span className="shrink-0 text-body-sm text-foreground-subtle">/shop/…/</span>
              <input
                type="text"
                name="slug"
                id="slug"
                defaultValue={values.slug}
                className={inputClass}
              />
            </div>
          </Field>

          <Field label="Subtitle" name="subtitle">
            <input
              type="text"
              name="subtitle"
              id="subtitle"
              defaultValue={values.subtitle}
              className={inputClass}
            />
          </Field>

          <Field
            label="Short description"
            name="shortDescription"
            hint="One or two sentences. Used on cards and as the meta description fallback."
          >
            <textarea
              name="shortDescription"
              id="shortDescription"
              rows={2}
              defaultValue={values.shortDescription}
              className={inputClass}
            />
          </Field>

          <Field label="Description" name="description">
            <textarea
              name="description"
              id="description"
              rows={10}
              defaultValue={values.description}
              className={cn(inputClass, 'font-mono text-body-xs')}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Parent SKU" name="sku">
              <input type="text" name="sku" id="sku" defaultValue={values.sku} className={inputClass} />
            </Field>
            <Field label="Barcode" name="barcode">
              <input
                type="text"
                name="barcode"
                id="barcode"
                defaultValue={values.barcode}
                className={inputClass}
              />
            </Field>
          </div>
        </Panel>

        <Panel id={formId} name="media" active={tab === 'media'}>
          {media && media.length > 0 ? (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {media.map((asset) => (
                <li key={asset.id} className="overflow-hidden rounded-lg border border-border">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={asset.url}
                    alt={asset.alt ?? ''}
                    className="aspect-square w-full object-cover"
                    loading="lazy"
                  />
                  <p className="truncate px-2 py-1.5 text-body-xs text-foreground-subtle">
                    {asset.alt ?? 'No alt text'}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="rounded-lg border border-dashed border-border px-4 py-10 text-center text-body-sm text-foreground-subtle">
              No images yet. Attach them from the{' '}
              <Link href="/admin/media" className="text-accent-text underline">
                media library
              </Link>
              .
            </p>
          )}
        </Panel>

        <Panel id={formId} name="variants" active={tab === 'variants'}>
          {variants && variants.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-body-sm">
                <thead>
                  <tr className="border-b border-border text-body-xs tracking-wide text-foreground-subtle uppercase">
                    <th scope="col" className="py-2 pr-3">Variant</th>
                    <th scope="col" className="py-2 pr-3">SKU</th>
                    <th scope="col" className="py-2 pr-3 text-right">Price</th>
                    <th scope="col" className="py-2 text-right">Available</th>
                  </tr>
                </thead>
                <tbody>
                  {variants.map((variant) => (
                    <tr key={variant.id} className="border-b border-border last:border-0">
                      <td className="py-2.5 pr-3">{variant.name}</td>
                      <td className="py-2.5 pr-3 font-mono text-body-xs text-foreground-subtle">
                        {variant.sku}
                      </td>
                      <td className="py-2.5 pr-3 text-right tabular-nums">
                        ${(variant.priceCents / 100).toFixed(2)}
                      </td>
                      <td
                        className={cn(
                          'py-2.5 text-right tabular-nums',
                          variant.stock <= 0 && 'text-danger-700',
                        )}
                      >
                        {variant.stock}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <p className="mt-4 text-body-xs text-foreground-subtle">
                Prices and stock are edited where they are managed:{' '}
                <Link href="/admin/inventory" className="text-accent-text underline">
                  Inventory
                </Link>{' '}
                records every stock change with a reason and an actor, which an inline edit here
                would bypass.
              </p>
            </div>
          ) : (
            <p className="rounded-lg border border-dashed border-border px-4 py-10 text-center text-body-sm text-foreground-subtle">
              No variants yet. A product needs at least one before it can be sold.
            </p>
          )}
        </Panel>

        <Panel id={formId} name="organisation" active={tab === 'organisation'}>
          <fieldset>
            <legend className="mb-2 text-body-sm font-medium">Categories</legend>
            <div className="grid max-h-64 gap-1.5 overflow-y-auto rounded-lg border border-border p-3 sm:grid-cols-2">
              {categories.map((category) => (
                <label key={category.id} className="flex items-center gap-2 text-body-sm">
                  <input
                    type="checkbox"
                    name="categoryIds"
                    value={category.id}
                    defaultChecked={values.categoryIds.includes(category.id)}
                    className="size-4 rounded border-border-strong text-accent"
                  />
                  <span className="truncate">{category.path ?? category.name}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="mt-5">
            <legend className="mb-2 text-body-sm font-medium">Collections</legend>
            <div className="grid gap-1.5 rounded-lg border border-border p-3 sm:grid-cols-2">
              {collections.length === 0 ? (
                <p className="text-body-sm text-foreground-subtle">No collections yet.</p>
              ) : (
                collections.map((collection) => (
                  <label key={collection.id} className="flex items-center gap-2 text-body-sm">
                    <input
                      type="checkbox"
                      name="collectionIds"
                      value={collection.id}
                      defaultChecked={values.collectionIds.includes(collection.id)}
                      className="size-4 rounded border-border-strong text-accent"
                    />
                    <span className="truncate">{collection.name}</span>
                  </label>
                ))
              )}
            </div>
          </fieldset>

          <Field label="Brand" name="brandId" className="mt-5">
            <select
              name="brandId"
              id="brandId"
              defaultValue={values.brandId}
              className={inputClass}
            >
              <option value="">No brand</option>
              {brands.map((brand) => (
                <option key={brand.id} value={brand.id}>
                  {brand.name}
                </option>
              ))}
            </select>
          </Field>
        </Panel>

        <Panel id={formId} name="seo" active={tab === 'seo'}>
          <Field
            label="Meta title"
            name="seoTitle"
            hint="Blank falls back to the product name. Around 60 characters before Google truncates."
          >
            <input
              type="text"
              name="seoTitle"
              id="seoTitle"
              defaultValue={values.seoTitle}
              maxLength={200}
              className={inputClass}
            />
          </Field>

          <Field
            label="Meta description"
            name="seoDescription"
            hint="Blank falls back to the short description. Around 155 characters."
          >
            <textarea
              name="seoDescription"
              id="seoDescription"
              rows={3}
              defaultValue={values.seoDescription}
              maxLength={400}
              className={inputClass}
            />
          </Field>

          <Field
            label="Canonical URL"
            name="seoCanonical"
            hint="Only when this product duplicates another page. Wrong values de-index the page."
          >
            <input
              type="url"
              name="seoCanonical"
              id="seoCanonical"
              defaultValue={values.seoCanonical}
              className={inputClass}
            />
          </Field>

          <label className="mt-4 flex items-start gap-2.5 text-body-sm">
            <input
              type="checkbox"
              name="seoNoindex"
              defaultChecked={values.seoNoindex}
              className="mt-0.5 size-4 rounded border-border-strong text-accent"
            />
            <span>
              Hide from search engines
              <span className="block text-body-xs text-foreground-subtle">
                The product stays buyable; search engines are asked not to index it.
              </span>
            </span>
          </label>
        </Panel>
      </div>

      {/* --- Sidebar: status, scheduling, save ---------------------------- */}
      <aside className="space-y-4 lg:sticky lg:top-20">
        <div className="rounded-xl border border-border bg-surface p-5">
          <Field label="Status" name="status">
            <select name="status" id="status" defaultValue={values.status} className={inputClass}>
              <option value="DRAFT">Draft</option>
              <option value="ACTIVE">Published</option>
              <option value="ARCHIVED">Archived</option>
            </select>
          </Field>

          <Field
            label="Publish at"
            name="publishedAt"
            hint="A future date schedules it. The storefront checks the clock, so nothing has to run to flip it."
          >
            <input
              type="datetime-local"
              name="publishedAt"
              id="publishedAt"
              defaultValue={values.publishedAt}
              className={inputClass}
            />
          </Field>

          <label className="mt-4 flex items-center gap-2.5 text-body-sm">
            <input
              type="checkbox"
              name="isFeatured"
              defaultChecked={values.isFeatured}
              className="size-4 rounded border-border-strong text-accent"
            />
            Featured
          </label>

          <label className="mt-2.5 flex items-center gap-2.5 text-body-sm">
            <input
              type="checkbox"
              name="isAdultOnly"
              defaultChecked={values.isAdultOnly}
              className="size-4 rounded border-border-strong text-accent"
            />
            Age-restricted
          </label>

          <button
            type="submit"
            disabled={pending}
            className="mt-5 w-full rounded-lg bg-accent px-4 py-2.5 text-body-sm font-medium text-white hover:bg-accent-hover disabled:opacity-60"
          >
            {pending ? 'Saving…' : values.id ? 'Save changes' : 'Create product'}
          </button>

          {/*
            `aria-live` so the result is announced. A visual-only confirmation
            leaves a screen-reader user with no idea whether the save worked.
          */}
          <p
            aria-live="polite"
            className={cn(
              'mt-3 text-body-xs',
              state.ok ? 'text-success-700' : 'text-danger-700',
              !state.message && 'sr-only',
            )}
          >
            {state.message ?? ''}
          </p>
        </div>

        {values.id ? (
          <div className="rounded-xl border border-border bg-surface p-5">
            <h2 className="text-body-sm font-semibold">Preview</h2>
            <p className="mt-1 text-body-xs text-foreground-subtle">
              Drafts are not reachable on the storefront, so this link only works once published.
            </p>
            <Link
              href={`/shop/${values.slug}`}
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-block rounded-lg border border-border px-3 py-1.5 text-body-xs font-medium hover:bg-surface-muted"
            >
              Open on storefront
            </Link>
          </div>
        ) : null}
      </aside>
    </form>
  );
}

const inputClass =
  'h-10 w-full rounded-lg border border-border bg-surface px-3 text-body-sm outline-none focus-visible:border-accent';

function Panel({
  id,
  name,
  active,
  children,
}: {
  id: string;
  name: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      role="tabpanel"
      id={`${id}-panel-${name}`}
      aria-labelledby={`${id}-tab-${name}`}
      hidden={!active}
      className="space-y-4 rounded-xl border border-border bg-surface p-5"
    >
      {children}
    </div>
  );
}

function Field({
  label,
  name,
  hint,
  error,
  required,
  className,
  children,
}: {
  label: string;
  name: string;
  hint?: string;
  error?: string;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={className}>
      <label htmlFor={name} className="mb-1.5 block text-body-sm font-medium">
        {label}
        {required ? (
          <span className="text-danger-700" aria-hidden="true">
            {' '}
            *
          </span>
        ) : null}
      </label>

      {children}

      {hint ? <p className="mt-1 text-body-xs text-foreground-subtle">{hint}</p> : null}
      {error ? (
        <p className="mt-1 text-body-xs text-danger-700" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
