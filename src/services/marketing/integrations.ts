import 'server-only';

import type { MarketingProvider } from '@/generated/prisma/enums';
import { remember, keys, invalidate } from '@/lib/cache/store';
import { prisma } from '@/lib/prisma';

/**
 * Marketing tags: which are on, and what they are allowed to do.
 *
 * ## Consent is not optional here
 *
 * Every advertising tag in this list is a third party watching a person browse
 * intimate products. Loading one before consent is given is a GDPR violation
 * in the EU and, more importantly, a betrayal of the specific expectation a
 * customer brings to a shop like this one.
 *
 * So the default is off, the default is `requiresConsent: true`, and the
 * script never reaches the page until consent is recorded. Analytics that
 * genuinely cannot identify anyone — GA4 in consent mode, our own first-party
 * events — can be argued differently, and that argument is a per-provider
 * setting rather than a blanket exemption.
 *
 * ## Why only public ids live here
 *
 * A measurement id or a pixel id is emitted into the page for anyone to read;
 * storing it in the database is not a secret leak. API secrets — the Merchant
 * Center service account, the Ads developer token — stay in the environment.
 * The split is the same one the settings screen makes: configuration is data,
 * credentials are not.
 */

export interface IntegrationConfig {
  provider: MarketingProvider;
  isEnabled: boolean;
  publicId: string | null;
  requiresConsent: boolean;
  config: Record<string, unknown>;
}

/** Everything the platform can be asked to load, with what each one needs. */
export const PROVIDERS: {
  provider: MarketingProvider;
  label: string;
  idLabel: string;
  idPattern?: RegExp;
  /** False only where the tag genuinely cannot identify an individual. */
  consentByDefault: boolean;
  hint: string;
}[] = [
  {
    provider: 'GA4',
    label: 'Google Analytics 4',
    idLabel: 'Measurement ID',
    idPattern: /^G-[A-Z0-9]{4,}$/,
    consentByDefault: true,
    hint: 'Runs in consent mode: it loads denied and upgrades only if consent is given.',
  },
  {
    provider: 'GTM',
    label: 'Google Tag Manager',
    idLabel: 'Container ID',
    idPattern: /^GTM-[A-Z0-9]{4,}$/,
    consentByDefault: true,
    hint: 'A container can load anything, so it inherits the strictest consent rules.',
  },
  {
    provider: 'GOOGLE_ADS',
    label: 'Google Ads',
    idLabel: 'Conversion ID',
    idPattern: /^AW-[0-9]{6,}$/,
    consentByDefault: true,
    hint: 'Conversion labels are set per event in the config.',
  },
  {
    provider: 'GOOGLE_MERCHANT',
    label: 'Google Merchant Center',
    idLabel: 'Merchant ID',
    consentByDefault: false,
    hint: 'Server-to-server: it reads /feeds/merchant.xml and sets no cookies.',
  },
  {
    provider: 'GOOGLE_SEARCH_CONSOLE',
    label: 'Google Search Console',
    idLabel: 'Verification token',
    consentByDefault: false,
    hint: 'A meta tag for site verification. No tracking, no cookies.',
  },
  {
    provider: 'META_PIXEL',
    label: 'Meta Pixel',
    idLabel: 'Pixel ID',
    idPattern: /^[0-9]{10,}$/,
    consentByDefault: true,
    hint: 'Sends browsing data to Meta. Never loads without consent.',
  },
  {
    provider: 'TIKTOK_PIXEL',
    label: 'TikTok Pixel',
    idLabel: 'Pixel ID',
    consentByDefault: true,
    hint: 'Sends browsing data to TikTok. Never loads without consent.',
  },
  {
    provider: 'PINTEREST_TAG',
    label: 'Pinterest Tag',
    idLabel: 'Tag ID',
    consentByDefault: true,
    hint: 'Sends browsing data to Pinterest. Never loads without consent.',
  },
  {
    provider: 'MICROSOFT_UET',
    label: 'Microsoft Advertising UET',
    idLabel: 'UET Tag ID',
    consentByDefault: true,
    hint: 'Sends browsing data to Microsoft. Never loads without consent.',
  },
  {
    provider: 'LINKEDIN_INSIGHT',
    label: 'LinkedIn Insight Tag',
    idLabel: 'Partner ID',
    consentByDefault: true,
    hint: 'Sends browsing data to LinkedIn. Never loads without consent.',
  },
];

/**
 * The enabled integrations, cached.
 *
 * Read on every page render, changed roughly never — exactly the shape a cache
 * is for. Five minutes, because a merchant switching a pixel on expects to see
 * it working before they lose patience.
 */
export async function activeIntegrations(): Promise<IntegrationConfig[]> {
  return remember(
    keys.marketing(),
    300,
    async () => {
      const rows = await prisma.marketingIntegration.findMany({
        where: { isEnabled: true, publicId: { not: null } },
        select: { provider: true, isEnabled: true, publicId: true, requiresConsent: true, config: true },
      });

      return rows.map((row) => ({
        provider: row.provider,
        isEnabled: row.isEnabled,
        publicId: row.publicId,
        requiresConsent: row.requiresConsent,
        config: (row.config ?? {}) as Record<string, unknown>,
      }));
    },
    ['marketing'],
  );
}

/** Every provider with its stored state, for the admin screen. */
export async function allIntegrations() {
  const stored = await prisma.marketingIntegration.findMany({
    include: { updatedBy: { select: { firstName: true, email: true } } },
  });

  const byProvider = new Map(stored.map((row) => [row.provider, row]));

  return PROVIDERS.map((definition) => ({
    ...definition,
    stored: byProvider.get(definition.provider) ?? null,
  }));
}

export async function saveIntegration(input: {
  provider: MarketingProvider;
  isEnabled: boolean;
  publicId: string | null;
  requiresConsent: boolean;
  config?: Record<string, unknown>;
  notes?: string | null;
  updatedById?: string | null;
}): Promise<void> {
  const definition = PROVIDERS.find((entry) => entry.provider === input.provider);

  /*
   * A malformed id is refused rather than saved.
   *
   * A pixel with a typo'd id fails silently — the script loads, the network
   * request 404s, and nobody notices for a month because the tag *looks*
   * installed. Validating the format catches the common half of that at the
   * moment someone can still fix it.
   */
  if (input.isEnabled && input.publicId && definition?.idPattern && !definition.idPattern.test(input.publicId)) {
    throw new Error(
      `That does not look like a ${definition.label} ${definition.idLabel.toLowerCase()}.`,
    );
  }

  await prisma.marketingIntegration.upsert({
    where: { provider: input.provider },
    update: {
      isEnabled: input.isEnabled,
      publicId: input.publicId,
      requiresConsent: input.requiresConsent,
      config: (input.config ?? {}) as never,
      notes: input.notes ?? null,
      updatedById: input.updatedById ?? null,
    },
    create: {
      provider: input.provider,
      isEnabled: input.isEnabled,
      publicId: input.publicId,
      requiresConsent: input.requiresConsent,
      config: (input.config ?? {}) as never,
      notes: input.notes ?? null,
      updatedById: input.updatedById ?? null,
    },
  });

  await invalidate('marketing');
}

/**
 * Splits integrations into those that may load immediately and those that wait.
 *
 * The page renders both lists; the consent banner decides when the second one
 * runs. Doing the split on the server means a tag requiring consent is never
 * even *described* to the browser until it is allowed — there is no script tag
 * to accidentally execute.
 */
export async function partitioned(): Promise<{
  immediate: IntegrationConfig[];
  onConsent: IntegrationConfig[];
}> {
  const all = await activeIntegrations();

  return {
    immediate: all.filter((entry) => !entry.requiresConsent),
    onConsent: all.filter((entry) => entry.requiresConsent),
  };
}

/** The Search Console verification token, for the document head. */
export async function searchConsoleToken(): Promise<string | null> {
  const all = await activeIntegrations();
  return all.find((entry) => entry.provider === 'GOOGLE_SEARCH_CONSOLE')?.publicId ?? null;
}
