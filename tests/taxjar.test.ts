import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * TaxJar response mapping.
 *
 * The provider is a network call, so what is testable — and what actually breaks —
 * is the translation at the boundary: dollars to integer cents, rates to basis
 * points, and the reconciliation that forces the per-jurisdiction split to sum to
 * the amount we actually charge.
 *
 * Every fixture below is the real shape of a `POST /v2/taxes` response.
 */

const ENV = {
  TAXJAR_API_KEY: 'test_key',
  SHIP_FROM_COUNTRY: 'US',
  SHIP_FROM_STATE: 'CA',
  SHIP_FROM_CITY: 'Los Angeles',
  SHIP_FROM_STREET: '1 Example St',
  SHIP_FROM_ZIP: '90001',
};

// Partial mock: `logger` also reads `isProduction` from this module, and a bare
// object mock would strip it.
vi.mock(import('@/lib/env'), async (importOriginal) => ({
  ...(await importOriginal()),
  env: ENV as never,
}));

const { isConfigured, quote } = await import('@/services/tax/taxjar');

const input = {
  address: { country: 'US', state: 'CA', city: 'Los Angeles', postalCode: '90002', line1: '1 A St' },
  taxableGoodsCents: 10_000,
  shippingCents: 599,
  lines: [{ unitPriceCents: 10_000, quantity: 1 }],
};

function respondWith(body: unknown, status = 200) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(body), { status })),
  );
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('isConfigured', () => {
  it('is true when a key and a ship-from address are present', () => {
    expect(isConfigured()).toBe(true);
  });
});

describe('quote', () => {
  it('converts dollars to integer cents and rates to basis points', async () => {
    respondWith({
      tax: {
        amount_to_collect: 8.25,
        rate: 0.0825,
        has_nexus: true,
        freight_taxable: false,
        jurisdictions: { state: 'CA', county: 'LOS ANGELES' },
        breakdown: {
          state_tax_rate: 0.0625,
          state_tax_collectable: 6.25,
          county_tax_rate: 0.02,
          county_tax_collectable: 2.0,
        },
      },
    });

    const result = await quote(input);

    expect(result.totalCents).toBe(825);
    expect(result.source).toBe('provider');
    expect(result.hasNexus).toBe(true);
    expect(result.lines).toEqual([
      { label: 'Ca state tax', rateBasisPoints: 625, amountCents: 625 },
      { label: 'Los Angeles county tax', rateBasisPoints: 200, amountCents: 200 },
    ]);
  });

  it('charges nothing where there is no nexus', async () => {
    // Not a gap in our data — an authoritative "you are not registered here".
    respondWith({ tax: { amount_to_collect: 0, rate: 0, has_nexus: false } });

    const result = await quote(input);

    expect(result.totalCents).toBe(0);
    expect(result.lines).toEqual([]);
    expect(result.hasNexus).toBe(false);
    expect(result.source).toBe('provider');
  });

  it('forces the components to sum to the charged total', async () => {
    // Components sum to 823c but the authoritative total is 825c. The receipt
    // must add up, so the 2c remainder goes onto the largest component.
    respondWith({
      tax: {
        amount_to_collect: 8.25,
        rate: 0.0825,
        has_nexus: true,
        freight_taxable: false,
        jurisdictions: { state: 'CA', county: 'LOS ANGELES' },
        breakdown: {
          state_tax_rate: 0.0625,
          state_tax_collectable: 6.23,
          county_tax_rate: 0.02,
          county_tax_collectable: 2.0,
        },
      },
    });

    const result = await quote(input);
    const sum = result.lines.reduce((total, line) => total + line.amountCents, 0);

    expect(sum).toBe(result.totalCents);
    expect(result.lines[0]?.amountCents).toBe(625);
  });

  it('synthesises a single line when a total arrives with no breakdown', async () => {
    respondWith({ tax: { amount_to_collect: 8.25, rate: 0.0825, has_nexus: true } });

    const result = await quote(input);

    expect(result.lines).toEqual([
      { label: 'Sales tax', rateBasisPoints: 0, amountCents: 825 },
    ]);
    expect(result.totalCents).toBe(825);
  });

  it('drops zero-value components', async () => {
    respondWith({
      tax: {
        amount_to_collect: 6.25,
        rate: 0.0625,
        has_nexus: true,
        jurisdictions: { state: 'CA' },
        breakdown: {
          state_tax_rate: 0.0625,
          state_tax_collectable: 6.25,
          city_tax_rate: 0,
          city_tax_collectable: 0,
        },
      },
    });

    const result = await quote(input);
    expect(result.lines).toHaveLength(1);
  });

  it('survives float artefacts in the conversion', async () => {
    // 0.29 * 100 is 28.999999999999996 in IEEE 754.
    respondWith({ tax: { amount_to_collect: 0.29, rate: 0.029, has_nexus: true } });

    const result = await quote(input);
    expect(result.totalCents).toBe(29);
  });

  it('throws on a non-2xx so the caller can decide the fallback', async () => {
    respondWith({ error: 'Unauthorized' }, 401);
    await expect(quote(input)).rejects.toThrow(/401/);
  });

  it('throws on a body without an amount', async () => {
    respondWith({ tax: {} });
    await expect(quote(input)).rejects.toThrow(/amount_to_collect/);
  });

  it('sends goods and shipping separately, in dollars', async () => {
    const spy = vi.fn(
      async (_url: string, _init: RequestInit) =>
        new Response(JSON.stringify({ tax: { amount_to_collect: 0, rate: 0, has_nexus: false } })),
    );
    vi.stubGlobal('fetch', spy);

    await quote(input);

    const body = JSON.parse(spy.mock.calls[0]![1].body as string);

    // Shipping is passed on its own — whether it is taxable is the
    // destination's call, not ours.
    expect(body.amount).toBe(100);
    expect(body.shipping).toBe(5.99);
    expect(body.to_zip).toBe('90002');
    expect(body.from_zip).toBe('90001');
  });
});
