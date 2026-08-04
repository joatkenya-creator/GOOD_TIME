import 'server-only';

import type { JobContext } from '@/lib/jobs/queue';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { fetchFeed, parseSource } from '@/services/import/adapters';
import { mapRow, type TemplateMapping } from '@/services/import/mapper';

/**
 * Price and inventory synchronisation.
 *
 * Separate from the full import on purpose. A nightly price sync touches two
 * numbers on products that already exist; running the whole create-or-update
 * pipeline for that would re-validate descriptions, re-resolve categories and
 * re-check images to change a price — forty times the work for the same result,
 * every night, across a hundred thousand products.
 *
 * Both are idempotent: running twice changes nothing the second time.
 */

interface SyncOptions {
  templateId?: string;
}

export interface SyncResult {
  templates: number;
  rowsRead: number;
  matched: number;
  changed: number;
  unmatched: number;
  errors: string[];
}

/** Templates whose config names a feed we can pull on a schedule. */
async function activeTemplates(templateId?: string) {
  return prisma.importTemplate.findMany({
    where: {
      isActive: true,
      ...(templateId ? { id: templateId } : {}),
    },
    select: { id: true, name: true, sourceType: true, mapping: true, defaults: true, config: true },
  });
}

/**
 * Pulls each template's feed and applies price changes only.
 *
 * Prices move in bulk and matter immediately — selling at last month's price
 * because a sync failed quietly is a margin problem nobody notices until the
 * month closes. So a price that moves by more than a threshold is *not* applied
 * silently; it raises an alert and is left for a human.
 */
export async function syncPrices(options: SyncOptions = {}, context?: JobContext): Promise<SyncResult> {
  const templates = await activeTemplates(options.templateId);

  const result: SyncResult = {
    templates: templates.length,
    rowsRead: 0,
    matched: 0,
    changed: 0,
    unmatched: 0,
    errors: [],
  };

  for (const [index, template] of templates.entries()) {
    const config = (template.config ?? {}) as { url?: string; headers?: Record<string, string>; delimiter?: string };

    if (!config.url) {
      // A template with no URL is a manual-upload template. Not an error.
      continue;
    }

    try {
      const fetched = await fetchFeed(config.url, { headers: config.headers });
      const parsed = await parseSource(template.sourceType, {
        text: fetched.text,
        buffer: fetched.buffer,
        delimiter: config.delimiter,
      });

      result.rowsRead += parsed.rows.length;

      for (const raw of parsed.rows) {
        const mapped = mapRow(raw, template.mapping as TemplateMapping, (template.defaults ?? {}) as Record<string, unknown>);

        const externalId = String(mapped.data.externalId ?? '');
        const sku = String(mapped.data.sku ?? '');
        const priceCents = Number(mapped.data.priceCents);

        if ((!externalId && !sku) || !Number.isFinite(priceCents) || priceCents < 0) continue;

        const variant = await prisma.variant.findFirst({
          where: {
            OR: [
              ...(sku ? [{ sku }] : []),
              ...(externalId ? [{ product: { externalId } }] : []),
            ],
          },
          select: { id: true, priceCents: true, sku: true, productId: true },
        });

        if (!variant) {
          result.unmatched += 1;
          continue;
        }

        result.matched += 1;
        if (variant.priceCents === priceCents) continue;

        /*
         * A price that moves more than 50% is refused, not applied.
         *
         * That is the signature of a broken feed — a currency column that
         * changed units, a decimal separator misread, a supplier exporting
         * cost instead of retail. Applying it means selling at a tenth of
         * cost until someone notices, and the whole point of automation is
         * that nobody is watching.
         */
        const ratio = variant.priceCents > 0 ? priceCents / variant.priceCents : Infinity;

        if (ratio > 1.5 || ratio < 0.5) {
          result.errors.push(
            `${variant.sku}: refused a price change from ${variant.priceCents} to ${priceCents} cents (${Math.round(
              (ratio - 1) * 100,
            )}%).`,
          );

          await prisma.adminAlert.upsert({
            where: { dedupeKey: `price-swing:${variant.id}:${priceCents}` },
            update: {},
            create: {
              dedupeKey: `price-swing:${variant.id}:${priceCents}`,
              type: 'import.price_swing',
              level: 'WARNING',
              title: `Large price change refused for ${variant.sku}`,
              body: `${template.name} sent ${(priceCents / 100).toFixed(2)}, currently ${(
                variant.priceCents / 100
              ).toFixed(2)}. Apply it by hand if it is correct.`,
              href: `/admin/products/${variant.productId}`,
            },
          });
          continue;
        }

        await prisma.$transaction([
          prisma.variant.update({ where: { id: variant.id }, data: { priceCents } }),
          prisma.product.update({
            where: { id: variant.productId },
            data: { minPriceCents: priceCents, maxPriceCents: priceCents },
          }),
        ]);

        result.changed += 1;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      result.errors.push(`${template.name}: ${message}`);
      logger.error('sync.price_failed', error, { templateId: template.id });
    }

    await context?.progress(index + 1, templates.length);
  }

  logger.info('sync.prices', { ...result, errors: result.errors.length });
  return result;
}

/**
 * Pulls each template's feed and applies stock levels.
 *
 * Every change goes through the stock ledger, exactly as a manual adjustment
 * does. A sync that wrote `quantity` directly would be the one path where
 * inventory changed with no record of why, which is precisely the hole the
 * ledger exists to close.
 */
export async function syncInventory(options: SyncOptions = {}, context?: JobContext): Promise<SyncResult> {
  const templates = await activeTemplates(options.templateId);

  const result: SyncResult = {
    templates: templates.length,
    rowsRead: 0,
    matched: 0,
    changed: 0,
    unmatched: 0,
    errors: [],
  };

  for (const [index, template] of templates.entries()) {
    const config = (template.config ?? {}) as { url?: string; headers?: Record<string, string>; delimiter?: string };
    if (!config.url) continue;

    try {
      const fetched = await fetchFeed(config.url, { headers: config.headers });
      const parsed = await parseSource(template.sourceType, {
        text: fetched.text,
        buffer: fetched.buffer,
        delimiter: config.delimiter,
      });

      result.rowsRead += parsed.rows.length;

      for (const raw of parsed.rows) {
        const mapped = mapRow(raw, template.mapping as TemplateMapping, (template.defaults ?? {}) as Record<string, unknown>);

        const sku = String(mapped.data.sku ?? '');
        const quantity = Number(mapped.data.quantity);

        if (!sku || !Number.isInteger(quantity) || quantity < 0) continue;

        const variant = await prisma.variant.findFirst({
          where: { sku },
          select: { id: true, inventory: { select: { quantity: true, reserved: true } } },
        });

        if (!variant?.inventory) {
          result.unmatched += 1;
          continue;
        }

        result.matched += 1;
        if (variant.inventory.quantity === quantity) continue;

        /*
         * Never below what is already reserved.
         *
         * A supplier saying "3 left" while five are in customers' carts would
         * otherwise produce negative availability, and the reservation is a
         * promise we already made.
         */
        const floor = variant.inventory.reserved;
        const applied = Math.max(quantity, floor);

        await prisma.$transaction([
          prisma.inventory.update({
            where: { variantId: variant.id },
            data: { quantity: applied },
          }),
          prisma.stockAdjustment.create({
            data: {
              variantId: variant.id,
              delta: applied - variant.inventory.quantity,
              quantityAfter: applied,
              reason: 'CORRECTION',
              note: `Supplier feed: ${template.name}`,
            },
          }),
        ]);

        result.changed += 1;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      result.errors.push(`${template.name}: ${message}`);
      logger.error('sync.inventory_failed', error, { templateId: template.id });
    }

    await context?.progress(index + 1, templates.length);
  }

  logger.info('sync.inventory', { ...result, errors: result.errors.length });
  return result;
}
