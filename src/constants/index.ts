export * from '@/constants/routes';
export * from '@/constants/permissions';

/** Listing defaults. `MAX_PAGE_SIZE` is the guard against `?limit=100000`. */
export const PAGINATION = {
  defaultPage: 1,
  defaultPageSize: 24,
  maxPageSize: 100,
} as const;

/** Cookie names. Prefixed so they are obvious in a browser inspector. */
export const COOKIES = {
  cart: 'gt.cart',
  ageGate: 'gt.age_ok',
  csrf: 'gt.csrf',
} as const;

export const CACHE_SECONDS = {
  minute: 60,
  fiveMinutes: 300,
  hour: 3_600,
  day: 86_400,
  week: 604_800,
} as const;

/** Token lifetimes, in seconds. */
export const TOKEN_TTL = {
  emailVerification: 60 * 60 * 24, // 24h
  passwordReset: 60 * 60, // 1h
  cartReservation: 60 * 15, // 15m
} as const;

export const SUPPORTED_CURRENCIES = ['USD'] as const;
export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];
