import 'dotenv/config';

import { createScriptClient } from './client';
import { FLAG_FACETS, facetToken, ratingFacetTokens } from '../src/features/catalog/facets';
import { priceRange } from '../src/features/catalog/pricing';

/**
 * Development catalogue fixtures.
 *
 * Separate from `seed.ts` on purpose. That one seeds roles, permissions and
 * settings and is safe to run on every deploy; this one inserts demo products and
 * must never run against production.
 *
 * Everything below is original placeholder copy. No product descriptions, images
 * or specifications are taken from any real retailer.
 *
 *   npm run db:seed:catalog
 */
const prisma = createScriptClient();

// ---------------------------------------------------------------------------
// Deterministic pseudo-randomness
// ---------------------------------------------------------------------------

/**
 * Seeded LCG rather than `Math.random`, so re-running the seed produces the same
 * catalogue. Reproducible fixtures make a visual regression or a failing query
 * something you can actually re-create.
 */
let randomState = 20260730;

function nextRandom(): number {
  randomState = (randomState * 1103515245 + 12345) % 2147483648;
  return randomState / 2147483648;
}

function randomInt(min: number, max: number): number {
  return min + Math.floor(nextRandom() * (max - min + 1));
}

function pick<T>(items: readonly T[]): T {
  return items[randomInt(0, items.length - 1)]!;
}

// ---------------------------------------------------------------------------
// Taxonomy
// ---------------------------------------------------------------------------

interface CategorySpec {
  slug: string;
  name: string;
  description: string;
  heroHeadline: string;
  heroBody: string;
  children?: { slug: string; name: string; description: string }[];
}

const CATEGORIES: CategorySpec[] = [
  {
    slug: 'vibrators',
    name: 'Vibrators',
    description:
      'Rechargeable vibrators in body-safe silicone, with motor strength and decibel level published on every listing.',
    heroHeadline: 'Vibrators, with the specs in plain sight',
    heroBody:
      'Every vibrator here is non-porous silicone or ABS, USB-C rechargeable, and listed with its noise level in decibels. Filter by how quiet you need it to be.',
    children: [
      {
        slug: 'wands',
        name: 'Wands',
        description: 'Full-size and mini wands with broad, deep motors for external use.',
      },
      {
        slug: 'bullets',
        name: 'Bullets',
        description: 'Compact, precise and quiet. The usual first purchase.',
      },
      {
        slug: 'dual-stimulation',
        name: 'Dual stimulation',
        description:
          'Two motors, independently controlled, for internal and external use together.',
      },
      {
        slug: 'remote-app',
        name: 'Remote & app',
        description: 'Wearable and insertable toys controlled by remote or phone.',
      },
    ],
  },
  {
    slug: 'dildos',
    name: 'Dildos',
    description:
      'Non-porous dildos in platinum-cure silicone, borosilicate glass and 316L stainless steel, with insertable length and diameter listed.',
    heroHeadline: 'Sized honestly, listed precisely',
    heroBody:
      'Insertable length, maximum diameter and base type on every listing. No porous materials, no rounded-up measurements.',
    children: [
      { slug: 'silicone', name: 'Silicone', description: 'Flexible, warm to the touch, boilable.' },
      {
        slug: 'glass',
        name: 'Glass',
        description: 'Borosilicate. Rigid, temperature-responsive, non-porous.',
      },
      {
        slug: 'steel',
        name: 'Steel',
        description: '316L surgical stainless. Weighted and lifetime-durable.',
      },
    ],
  },
  {
    slug: 'anal',
    name: 'Anal play',
    description:
      'Plugs, beads and prostate toys with flared bases, graduated sizing and body-safe materials throughout.',
    heroHeadline: 'Start small, published sizing',
    heroBody:
      'Every item has a flared or T-bar base, and graduated sets state each stage separately so you can see exactly where you are starting.',
    children: [
      {
        slug: 'plugs',
        name: 'Plugs',
        description: 'Weighted and light, single and graduated sets.',
      },
      { slug: 'beads', name: 'Beads', description: 'Graduated strands with a retrieval loop.' },
      {
        slug: 'prostate',
        name: 'Prostate',
        description: 'Curved and angled, vibrating and manual.',
      },
    ],
  },
  {
    slug: 'strokers',
    name: 'Strokers & sleeves',
    description:
      'Textured sleeves and powered strokers, all non-porous and fully openable for cleaning.',
    heroHeadline: 'Cleanable, not just washable',
    heroBody:
      'Every sleeve here opens fully or is made of a non-porous material. If it cannot be properly cleaned, it is not stocked.',
  },
  {
    slug: 'couples',
    name: 'Couples’ toys',
    description: 'Rings, wearables and app-controlled toys designed to be used with a partner.',
    heroHeadline: 'Made for two, controlled by either',
    heroBody:
      'Grouped by who holds the controls, because that is the decision people are actually making.',
    children: [
      {
        slug: 'rings',
        name: 'Rings',
        description: 'Vibrating and plain, stretch-rated and sized.',
      },
      { slug: 'wearable', name: 'Wearable', description: 'Hands-free designs for use together.' },
    ],
  },
  {
    slug: 'bondage-kink',
    name: 'Bondage & kink',
    description:
      'Restraints, blindfolds and impact play with quick-release hardware and lined cuffs.',
    heroHeadline: 'Quick-release as standard',
    heroBody:
      'Every restraint has a quick-release mechanism and lined interior. Safety hardware is a requirement, not an upgrade.',
    children: [
      {
        slug: 'restraints',
        name: 'Restraints',
        description: 'Lined cuffs and ties with quick-release.',
      },
      {
        slug: 'blindfolds',
        name: 'Blindfolds',
        description: 'Padded, adjustable, fully light-blocking.',
      },
      {
        slug: 'impact',
        name: 'Impact',
        description: 'Paddles and floggers with published weight and reach.',
      },
    ],
  },
  {
    slug: 'lubricants-care',
    name: 'Lubricants & care',
    description:
      'Water-based and silicone lubricants plus toy cleaners, with full ingredient lists and material compatibility.',
    heroHeadline: 'Full ingredients, stated compatibility',
    heroBody:
      'Every lubricant lists its complete ingredients and which toy materials it is safe with. Silicone lubricant degrades silicone toys — we say so on the label.',
    children: [
      { slug: 'water-based', name: 'Water-based', description: 'Safe with every toy material.' },
      {
        slug: 'silicone-based',
        name: 'Silicone-based',
        description: 'Long-lasting. Not for silicone toys.',
      },
      { slug: 'toy-cleaner', name: 'Toy cleaner', description: 'Fragrance-free, alcohol-free.' },
    ],
  },
];

const BRANDS = [
  {
    slug: 'lumen',
    name: 'Lumen',
    description:
      'Engineering-led studio focused on motor quality and quiet operation. Every product ships with a published decibel measurement and a two-year warranty.',
  },
  {
    slug: 'aster-and-ives',
    name: 'Aster & Ives',
    description:
      'Materials specialists working exclusively in platinum-cure silicone, borosilicate glass and surgical steel. Nothing in the range is porous.',
  },
  {
    slug: 'good-time-studio',
    name: 'Good Time Studio',
    description:
      'Our own line. Designed in-house, made in the US, refillable where the format allows, priced without the brand premium.',
  },
];

const COLLECTIONS = [
  {
    slug: 'quiet-hours',
    title: 'The Quiet Hours',
    description:
      'Everything in this edit runs under 45 dB — quieter than a household fridge. Rechargeable, body-safe silicone, tested through a wall rather than in a soundproof booth.',
  },
  {
    slug: 'first-toy',
    title: 'First Toy',
    description:
      'Chosen for a first purchase: modest sizing, simple controls, quiet motors and no learning curve. Insertable length and decibel level on every listing.',
  },
  {
    slug: 'better-together',
    title: 'Better Together',
    description:
      'Rings, wearables and app-controlled toys designed to be used with someone else, grouped by who holds the controls.',
  },
  {
    slug: 'kink-curious',
    title: 'Kink Curious',
    description:
      'A starting point for restraint and sensation play. Lined cuffs, quick-release hardware, and a guide in every box.',
  },
  {
    slug: 'gift-edit',
    title: 'The Gift Edit',
    description:
      'Sets that arrive in plain packaging with a card rather than a catalogue. Gifting without the guesswork.',
  },
];

/** Filterable and spec-table attributes. `isFilterable` drives the facet tokens. */
const ATTRIBUTES = [
  {
    key: 'material',
    label: 'Material',
    type: 'ENUM' as const,
    group: 'materials',
    isFilterable: true,
    position: 1,
    options: [
      'Platinum-cure silicone',
      'Borosilicate glass',
      '316L stainless steel',
      'ABS plastic',
      'Vegan leather',
      'Water-based formula',
    ],
  },
  {
    key: 'power',
    label: 'Power',
    type: 'ENUM' as const,
    group: 'performance',
    isFilterable: true,
    position: 2,
    options: ['USB-C rechargeable', 'Magnetic charging', 'Manual — no power'],
  },
  {
    key: 'waterproof',
    label: 'Waterproof',
    type: 'BOOLEAN' as const,
    group: 'performance',
    isFilterable: true,
    position: 3,
    options: [],
  },
  {
    key: 'noise-level',
    label: 'Noise level',
    type: 'NUMBER' as const,
    unit: 'dB',
    group: 'performance',
    isFilterable: false,
    position: 4,
    options: [],
  },
  {
    key: 'runtime',
    label: 'Runtime',
    type: 'NUMBER' as const,
    unit: 'minutes',
    group: 'performance',
    isFilterable: false,
    position: 5,
    options: [],
  },
  {
    key: 'charge-time',
    label: 'Charge time',
    type: 'NUMBER' as const,
    unit: 'minutes',
    group: 'performance',
    isFilterable: false,
    position: 6,
    options: [],
  },
  {
    key: 'warranty',
    label: 'Warranty',
    type: 'TEXT' as const,
    group: 'care',
    isFilterable: false,
    position: 7,
    options: [],
  },
  {
    key: 'cleaning',
    label: 'Cleaning',
    type: 'TEXT' as const,
    group: 'care',
    isFilterable: false,
    position: 8,
    options: [],
  },
];

const TAGS = [
  { slug: 'waterproof', name: 'Waterproof', isFilterable: true },
  { slug: 'rechargeable', name: 'Rechargeable', isFilterable: true },
  { slug: 'app-controlled', name: 'App controlled', isFilterable: true },
  { slug: 'quiet', name: 'Whisper quiet', isFilterable: true },
  { slug: 'beginner', name: 'Beginner friendly', isFilterable: true },
  { slug: 'travel-lock', name: 'Travel lock', isFilterable: true },
  { slug: 'fragrance-free', name: 'Fragrance free', isFilterable: true },
  { slug: 'made-in-usa', name: 'Made in the USA', isFilterable: true },
];

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

interface ProductSpec {
  slug: string;
  name: string;
  category: string;
  subcategory?: string;
  brand: string;
  shortDescription: string;
  description: string;
  features: string[];
  priceCents: number;
  salePriceCents?: number;
  compareAtPriceCents?: number;
  material: string;
  power: string;
  waterproof: boolean;
  noiseDb?: number;
  runtimeMinutes?: number;
  chargeMinutes?: number;
  colors?: string[];
  sizes?: string[];
  insertableLengthMm?: number;
  diameterMm?: number;
  tags: string[];
  collections?: string[];
  featured?: boolean;
  newArrival?: boolean;
}

const PRODUCTS: ProductSpec[] = [
  {
    slug: 'aurora-rechargeable-wand',
    name: 'Aurora Rechargeable Wand',
    category: 'vibrators',
    subcategory: 'wands',
    brand: 'lumen',
    shortDescription:
      'Full-size wand with a deep, broad motor and a flexible neck. 42 dB at maximum, USB-C rechargeable.',
    description:
      'A full-size wand built around a low-frequency motor that delivers depth rather than buzz. The neck flexes about thirty degrees so pressure stays comfortable through a longer session, and the head is a single piece of platinum-cure silicone with no seam to trap anything.\n\nEight intensity steps and four patterns, all reachable with one thumb. The travel lock is a three-second press, which matters if this lives in a suitcase. Charging is USB-C from either end of the cable, and a full charge takes ninety minutes for two hours of use at medium.',
    features: [
      'Low-frequency motor tuned for depth over buzz',
      '42 dB at maximum — quieter than a household fridge',
      'Flexible neck with roughly 30 degrees of give',
      'Seamless platinum-cure silicone head',
      'Eight intensity steps, four patterns, one-thumb control',
      'Travel lock and USB-C charging',
    ],
    priceCents: 16_500,
    salePriceCents: 13_900,
    compareAtPriceCents: 16_500,
    material: 'Platinum-cure silicone',
    power: 'USB-C rechargeable',
    waterproof: true,
    noiseDb: 42,
    runtimeMinutes: 120,
    chargeMinutes: 90,
    colors: ['Rose', 'Slate', 'Ivory'],
    tags: ['waterproof', 'rechargeable', 'quiet', 'travel-lock'],
    collections: ['quiet-hours', 'gift-edit'],
    featured: true,
  },
  {
    slug: 'pebble-bullet-vibrator',
    name: 'Pebble Bullet Vibrator',
    category: 'vibrators',
    subcategory: 'bullets',
    brand: 'good-time-studio',
    shortDescription:
      'Palm-sized single-motor bullet at 38 dB. Three speeds, one button, ninety minutes of runtime.',
    description:
      'The simplest thing we sell, and the one we recommend most often as a first purchase. One button, three speeds, no patterns to scroll through. The whole body is ABS with a silicone tip, so it wipes clean in seconds.\n\nAt 38 dB it is the quietest item in the range — genuinely inaudible through a closed door. Ninety minutes of runtime from a forty-minute charge, and it holds that charge for months in a drawer.',
    features: [
      '38 dB — the quietest toy we stock',
      'One button, three speeds, no menu to scroll',
      '90 minutes of runtime from a 40-minute charge',
      'ABS body with a silicone tip',
      'Fully submersible for cleaning',
    ],
    priceCents: 3900,
    material: 'ABS plastic',
    power: 'USB-C rechargeable',
    waterproof: true,
    noiseDb: 38,
    runtimeMinutes: 90,
    chargeMinutes: 40,
    colors: ['Rose', 'Charcoal'],
    tags: ['waterproof', 'rechargeable', 'quiet', 'beginner'],
    collections: ['first-toy', 'quiet-hours'],
    featured: true,
  },
  {
    slug: 'ember-dual-stimulation-vibrator',
    name: 'Ember Dual-Stimulation Vibrator',
    category: 'vibrators',
    subcategory: 'dual-stimulation',
    brand: 'good-time-studio',
    shortDescription:
      'Two independently controlled motors, 44 dB, with an internal arm shaped for a shallower angle.',
    description:
      'Two motors on separate circuits, each with its own control, so the internal and external intensity never have to match. The internal arm sits at a shallower angle than most dual toys, which suits a wider range of anatomy without needing to be forced into position.\n\nPlatinum-cure silicone throughout, fully submersible, and a travel lock. Two hours at medium from a two-hour charge.',
    features: [
      'Two motors, two independent controls',
      'Shallower internal angle than most dual designs',
      '44 dB at maximum',
      'Seamless platinum-cure silicone',
      'Travel lock and full submersion',
    ],
    priceCents: 12_400,
    salePriceCents: 9900,
    compareAtPriceCents: 12_400,
    material: 'Platinum-cure silicone',
    power: 'USB-C rechargeable',
    waterproof: true,
    noiseDb: 44,
    runtimeMinutes: 120,
    chargeMinutes: 120,
    colors: ['Rose', 'Plum'],
    tags: ['waterproof', 'rechargeable', 'quiet', 'travel-lock'],
    collections: ['quiet-hours'],
  },
  {
    slug: 'vesper-app-controlled-egg',
    name: 'Vesper App-Controlled Egg',
    category: 'vibrators',
    subcategory: 'remote-app',
    brand: 'lumen',
    shortDescription:
      'Insertable egg with app and remote control, a retrieval cord, and a 10 m Bluetooth range.',
    description:
      'An insertable egg controlled from a phone or the included remote. The retrieval cord is silicone-sheathed steel rather than a moulded tab, which is the part that fails on cheaper designs.\n\nBluetooth range is about ten metres through open air and rather less through walls — we quote the honest figure rather than the laboratory one. The app stores custom patterns locally on the device; nothing about your usage is uploaded.',
    features: [
      'App and physical remote, both included',
      'Silicone-sheathed steel retrieval cord',
      '~10 m Bluetooth range in open air',
      'Custom patterns stored on-device, never uploaded',
      'Waterproof to IPX7',
    ],
    priceCents: 11_900,
    material: 'Platinum-cure silicone',
    power: 'Magnetic charging',
    waterproof: true,
    noiseDb: 46,
    runtimeMinutes: 100,
    chargeMinutes: 75,
    insertableLengthMm: 75,
    diameterMm: 32,
    tags: ['waterproof', 'rechargeable', 'app-controlled'],
    collections: ['better-together'],
    newArrival: true,
  },
  {
    slug: 'meridian-silicone-dildo',
    name: 'Meridian Silicone Dildo',
    category: 'dildos',
    subcategory: 'silicone',
    brand: 'aster-and-ives',
    shortDescription:
      'Platinum-cure silicone with a suction base, in three insertable lengths from 120 mm.',
    description:
      'A single piece of platinum-cure silicone with a gentle upward curve and a flat suction base that genuinely holds on tile and glass. Boilable and dishwasher-safe on the top rack.\n\nSizes are stated as insertable length and maximum diameter, measured rather than estimated. The 120 mm is the one we point first-time buyers towards.',
    features: [
      'Single-piece platinum-cure silicone, no seam',
      'Suction base rated for tile and glass',
      'Boilable and top-rack dishwasher safe',
      'Measured insertable length and maximum diameter',
      'Harness-compatible on all sizes',
    ],
    priceCents: 7400,
    material: 'Platinum-cure silicone',
    power: 'Manual — no power',
    waterproof: true,
    sizes: ['120 mm', '150 mm', '180 mm'],
    colors: ['Rose', 'Sand'],
    insertableLengthMm: 120,
    diameterMm: 36,
    tags: ['beginner', 'made-in-usa'],
    collections: ['first-toy'],
    featured: true,
  },
  {
    slug: 'quill-borosilicate-glass-wand',
    name: 'Quill Borosilicate Glass Wand',
    category: 'dildos',
    subcategory: 'glass',
    brand: 'aster-and-ives',
    shortDescription:
      'Annealed borosilicate with a ridged shaft. Temperature-responsive, entirely non-porous.',
    description:
      'Annealed borosilicate glass, which is the same material as laboratory glassware — rigid, completely non-porous and safe to warm or cool in a water bath. The ridging is shallow enough to feel without catching.\n\nGlass is the easiest material to sanitise properly and the only one that will outlast the person who bought it. Each piece is inspected for inclusions before it ships.',
    features: [
      'Annealed borosilicate, inspected for inclusions',
      'Warm or cool in a water bath — never a microwave',
      'Completely non-porous',
      'Compatible with every lubricant type',
      'Ships in a lined storage tube',
    ],
    priceCents: 6400,
    material: 'Borosilicate glass',
    power: 'Manual — no power',
    waterproof: true,
    insertableLengthMm: 140,
    diameterMm: 32,
    tags: ['fragrance-free'],
    newArrival: true,
  },
  {
    slug: 'onyx-weighted-steel-plug',
    name: 'Onyx Weighted Steel Plug',
    category: 'anal',
    subcategory: 'plugs',
    brand: 'aster-and-ives',
    shortDescription: '316L surgical stainless with a T-bar base, in three weights from 140 g.',
    description:
      '316L surgical stainless steel, mirror-polished, with a T-bar base that will not migrate. The weight is the point: it provides a constant, passive sensation that a silicone plug of the same size cannot.\n\nSteel takes and holds temperature, so a minute under warm water makes a noticeable difference. Sanitise by boiling. This will last indefinitely.',
    features: [
      '316L surgical stainless, mirror-polished',
      'T-bar base that will not migrate',
      'Three weights: 140 g, 210 g, 290 g',
      'Holds temperature — warm before use',
      'Boilable, non-porous, effectively permanent',
    ],
    priceCents: 8900,
    material: '316L stainless steel',
    power: 'Manual — no power',
    waterproof: true,
    sizes: ['140 g', '210 g', '290 g'],
    insertableLengthMm: 75,
    diameterMm: 32,
    tags: ['made-in-usa'],
    featured: true,
  },
  {
    slug: 'graduated-silicone-plug-trio',
    name: 'Graduated Silicone Plug Trio',
    category: 'anal',
    subcategory: 'plugs',
    brand: 'good-time-studio',
    shortDescription:
      'Three plugs at 26 mm, 32 mm and 38 mm, each with a flared base and its own measurements.',
    description:
      'Three separate plugs rather than one adjustable compromise, at 26 mm, 32 mm and 38 mm maximum diameter. Each one is listed with its own insertable length so there is no guessing about the step between sizes.\n\nPlatinum-cure silicone with a flared base on every piece. Supplied in a lined case that keeps them from touching each other, which is how silicone picks up marks in a drawer.',
    features: [
      'Three sizes: 26 mm, 32 mm, 38 mm maximum diameter',
      'Individual insertable length stated for each',
      'Flared base on every piece',
      'Platinum-cure silicone, boilable',
      'Lined storage case included',
    ],
    priceCents: 4900,
    material: 'Platinum-cure silicone',
    power: 'Manual — no power',
    waterproof: true,
    insertableLengthMm: 85,
    diameterMm: 26,
    tags: ['beginner', 'made-in-usa'],
    collections: ['first-toy'],
  },
  {
    slug: 'drift-textured-stroker',
    name: 'Drift Textured Stroker',
    category: 'strokers',
    brand: 'lumen',
    shortDescription:
      'Fully openable sleeve with an asymmetric internal texture. Non-porous and dishwasher-safe.',
    description:
      'The sleeve opens completely flat, which is the only way a stroker can actually be cleaned rather than rinsed and hoped about. Non-porous throughout and safe on the top rack of a dishwasher.\n\nThe internal texture is asymmetric rather than uniformly ribbed, so rotating it changes the sensation. Supplied with a drying stand, because the reason these fail early is being put away damp.',
    features: [
      'Opens completely flat for genuine cleaning',
      'Non-porous, top-rack dishwasher safe',
      'Asymmetric internal texture',
      'Drying stand included',
      'Open-ended for adjustable pressure',
    ],
    priceCents: 5400,
    material: 'Platinum-cure silicone',
    power: 'Manual — no power',
    waterproof: true,
    tags: ['fragrance-free'],
  },
  {
    slug: 'halo-vibrating-ring',
    name: 'Halo Vibrating Ring',
    category: 'couples',
    subcategory: 'rings',
    brand: 'lumen',
    shortDescription:
      'Stretch-rated silicone ring with a removable motor. Two sizes, thirty minutes of runtime.',
    description:
      'A silicone ring with a removable bullet motor, in two sizes with the unstretched and maximum stretched circumference both published. Guessing at ring sizing is uncomfortable at best.\n\nThe motor pops out for charging and for use on its own. Thirty minutes of runtime, which is the honest figure for a motor this small.',
    features: [
      'Unstretched and maximum circumference both stated',
      'Removable motor, usable on its own',
      'Two sizes',
      '30 minutes of runtime — the real figure',
      'Fully submersible',
    ],
    priceCents: 6900,
    salePriceCents: 5900,
    compareAtPriceCents: 6900,
    material: 'Platinum-cure silicone',
    power: 'USB-C rechargeable',
    waterproof: true,
    noiseDb: 45,
    runtimeMinutes: 30,
    chargeMinutes: 45,
    sizes: ['Standard', 'Large'],
    tags: ['waterproof', 'rechargeable'],
    collections: ['better-together'],
  },
  {
    slug: 'tandem-wearable-vibrator',
    name: 'Tandem Wearable Vibrator',
    category: 'couples',
    subcategory: 'wearable',
    brand: 'lumen',
    shortDescription:
      'Hands-free wearable with app control and two motors. Designed to stay in place during use.',
    description:
      'A wearable with two motors and no external controls to dig in, held by geometry rather than by pressure. App-controlled, with the same on-device pattern storage as the rest of the Lumen range.\n\nThe arms are individually adjustable and hold their set position, which is what separates a wearable that stays put from one that does not.',
    features: [
      'Two motors, individually controlled',
      'Individually adjustable arms that hold position',
      'App control with on-device pattern storage',
      'No external controls to press in',
      'IPX7 waterproof',
    ],
    priceCents: 15_900,
    material: 'Platinum-cure silicone',
    power: 'Magnetic charging',
    waterproof: true,
    noiseDb: 47,
    runtimeMinutes: 90,
    chargeMinutes: 90,
    tags: ['waterproof', 'rechargeable', 'app-controlled'],
    collections: ['better-together'],
    newArrival: true,
  },
  {
    slug: 'linen-lined-cuff-set',
    name: 'Linen-Lined Cuff Set',
    category: 'bondage-kink',
    subcategory: 'restraints',
    brand: 'good-time-studio',
    shortDescription:
      'Vegan leather cuffs with linen lining and quick-release clips. Adjustable 140–230 mm.',
    description:
      'Wrist and ankle cuffs in vegan leather, lined with linen so they stay comfortable over a longer session rather than for five minutes. Adjustable from 140 mm to 230 mm.\n\nThe clips are quick-release under load — squeeze and they open, no unbuckling. Safety hardware is the whole point of buying restraints rather than improvising with a scarf.',
    features: [
      'Linen-lined vegen leather, adjustable 140–230 mm',
      'Quick-release clips that open under load',
      'Four cuffs: two wrist, two ankle',
      'Nickel-free hardware',
      'Includes a printed safety and negotiation guide',
    ],
    priceCents: 9400,
    salePriceCents: 7900,
    compareAtPriceCents: 9400,
    material: 'Vegan leather',
    power: 'Manual — no power',
    waterproof: false,
    tags: ['beginner'],
    collections: ['kink-curious'],
  },
  {
    slug: 'blackout-padded-blindfold',
    name: 'Blackout Padded Blindfold',
    category: 'bondage-kink',
    subcategory: 'blindfolds',
    brand: 'good-time-studio',
    shortDescription:
      'Contoured, fully light-blocking blindfold with an adjustable strap and no nose gap.',
    description:
      'Contoured around the nose so there is no light gap, which is the flaw in almost every flat blindfold. Memory foam padding and a fully adjustable strap that does not catch hair.\n\nWashable cover that removes without tools. Blocks light completely rather than mostly.',
    features: [
      'Contoured nose bridge — no light gap',
      'Memory foam padding',
      'Adjustable strap that does not catch hair',
      'Removable, washable cover',
    ],
    priceCents: 2900,
    material: 'Vegan leather',
    power: 'Manual — no power',
    waterproof: false,
    tags: ['beginner'],
    collections: ['kink-curious'],
  },
  {
    slug: 'tide-water-based-lubricant',
    name: 'Tide Water-Based Lubricant',
    category: 'lubricants-care',
    subcategory: 'water-based',
    brand: 'good-time-studio',
    shortDescription:
      'Fragrance-free, glycerin-free water-based lubricant. Safe with every toy material and with latex.',
    description:
      'A water-based lubricant with the complete ingredient list on the bottle and on this page. No glycerin, no fragrance, no parabens, no numbing agents. pH-balanced and osmolality-tested.\n\nSafe with every toy material we stock, and with latex and polyisoprene barriers. Available in 150 ml and 300 ml, and in a refill pouch that costs less per millilitre than the bottle.',
    features: [
      'Complete ingredient list published',
      'Glycerin-free, fragrance-free, paraben-free',
      'pH-balanced and osmolality-tested',
      'Safe with all toy materials and latex',
      'Refill pouch available',
    ],
    priceCents: 1800,
    material: 'Water-based formula',
    power: 'Manual — no power',
    waterproof: false,
    sizes: ['150 ml', '300 ml'],
    tags: ['fragrance-free', 'made-in-usa'],
    collections: ['first-toy'],
    featured: true,
  },
  {
    slug: 'reset-toy-cleaner',
    name: 'Reset Toy Cleaner',
    category: 'lubricants-care',
    subcategory: 'toy-cleaner',
    brand: 'good-time-studio',
    shortDescription:
      'Alcohol-free, fragrance-free spray cleaner. Safe on silicone, glass, steel and ABS.',
    description:
      'An alcohol-free spray cleaner for everyday use between deep cleans. Alcohol dries and eventually cracks silicone, which is why it is not in here.\n\nSafe on every material we stock. This is not a substitute for boiling silicone or steel when a toy has been shared — the care guide explains when each is appropriate.',
    features: [
      'Alcohol-free — will not dry out silicone',
      'Fragrance-free and dye-free',
      'Safe on silicone, glass, steel and ABS',
      '200 ml spray, roughly 200 applications',
    ],
    priceCents: 1400,
    material: 'Water-based formula',
    power: 'Manual — no power',
    waterproof: false,
    tags: ['fragrance-free', 'made-in-usa'],
  },
  {
    slug: 'harbour-lockable-storage-case',
    name: 'Harbour Lockable Storage Case',
    category: 'lubricants-care',
    brand: 'good-time-studio',
    shortDescription:
      'Lined, lockable case with dividers so silicone pieces never touch. Fits five average toys.',
    description:
      'A lockable case with removable dividers, lined in a fabric that will not react with silicone. Toys touching each other in a drawer is the most common cause of surface marking, and this is the fix.\n\nCombination lock rather than a key, because keys get lost. Holds about five average-sized items.',
    features: [
      'Removable dividers keep silicone pieces apart',
      'Non-reactive lining',
      'Three-digit combination lock',
      'Holds roughly five average items',
      'Ventilated so nothing is stored damp',
    ],
    priceCents: 4400,
    material: 'Vegan leather',
    power: 'Manual — no power',
    waterproof: false,
    tags: ['travel-lock'],
    collections: ['gift-edit'],
  },
  {
    slug: 'evening-set-gift-box',
    name: 'Evening Set Gift Box',
    category: 'lubricants-care',
    brand: 'good-time-studio',
    shortDescription:
      'Bullet vibrator, water-based lubricant and toy cleaner in a plain gift box with a blank card.',
    description:
      'The three things someone actually needs, in a plain box with a blank card rather than branded packaging and a catalogue. Contains the Pebble bullet, a 150 ml Tide lubricant and a 200 ml Reset cleaner.\n\nShips in the same unbranded outer box as everything else, so it can be sent directly to a recipient without announcing itself.',
    features: [
      'Pebble Bullet, Tide 150 ml and Reset 200 ml',
      'Plain gift box with a blank card',
      'Ships direct to a recipient, unbranded',
      'Saves about 15% against buying separately',
    ],
    priceCents: 6400,
    salePriceCents: 5400,
    compareAtPriceCents: 6400,
    material: 'Platinum-cure silicone',
    power: 'USB-C rechargeable',
    waterproof: true,
    tags: ['beginner', 'made-in-usa'],
    collections: ['gift-edit', 'first-toy'],
  },
];

// ---------------------------------------------------------------------------
// Review copy
// ---------------------------------------------------------------------------

const REVIEW_AUTHORS = [
  { name: 'Maya R.', location: 'Austin, TX' },
  { name: 'Devon K.', location: 'Portland, OR' },
  { name: 'Priya S.', location: 'Chicago, IL' },
  { name: 'Alex T.', location: 'Brooklyn, NY' },
  { name: 'Jordan M.', location: 'Denver, CO' },
  { name: 'Sam W.', location: 'Seattle, WA' },
  { name: 'Riley B.', location: 'Atlanta, GA' },
  { name: 'Casey L.', location: 'Boston, MA' },
  { name: 'Noor A.', location: 'Phoenix, AZ' },
  { name: 'Toni G.', location: 'Minneapolis, MN' },
];

const REVIEW_TEMPLATES: { rating: number; title: string; body: string }[] = [
  {
    rating: 5,
    title: 'The listed specs were accurate',
    body: 'I bought this because the noise figure was published and I share a wall. It measured about what they said on my phone app. Refreshing to find a listing that does not exaggerate.',
  },
  {
    rating: 5,
    title: 'Packaging was genuinely plain',
    body: 'Unmarked box, nothing on the label, and the card statement showed a neutral company name. Exactly as described on the shipping page. That was the main reason I ordered here.',
  },
  {
    rating: 5,
    title: 'Material information I could actually check',
    body: 'The listing names the exact material and what it was tested for. I have wasted a lot of time emailing other shops to ask whether something is real silicone. Not needed here.',
  },
  {
    rating: 4,
    title: 'Good, with one small caveat',
    body: 'Well made and does what it says. Only reason for four stars is that I would have liked one more colour option. Everything else was as described, including the measurements.',
  },
  {
    rating: 5,
    title: 'Charge life as advertised',
    body: 'Runtime matches the listing, and it charges over USB-C rather than some proprietary cable I would inevitably lose. That detail is why I picked it over a better-known brand.',
  },
  {
    rating: 5,
    title: 'Sizing was honest',
    body: 'Insertable length was stated and accurate, which made this a much less daunting first purchase. The size guide is worth reading before you order.',
  },
  {
    rating: 4,
    title: 'Solid, cleaning is easy',
    body: 'Comes apart properly for cleaning, which was my main worry. Slightly heavier than I expected from the photos but that turned out to be a good thing.',
  },
  {
    rating: 5,
    title: 'Support answered a specific question',
    body: 'Asked about lubricant compatibility before ordering and got a clear, unembarrassed answer within a few hours, with a link to the compatibility chart. No awkwardness.',
  },
  {
    rating: 3,
    title: 'Fine, but not for me',
    body: 'No complaints about the build quality or the accuracy of the listing — it simply was not the right shape for me. Returns process was straightforward since it was unopened.',
  },
  {
    rating: 5,
    title: 'Quieter than I expected',
    body: 'I was sceptical about the decibel claim. It is genuinely quiet, quieter than my electric toothbrush, and inaudible with a door closed.',
  },
];

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------

/**
 * Clears the catalogue.
 *
 * Sequential rather than one interactive transaction: two dozen `deleteMany`
 * round trips to a hosted database comfortably exceed Prisma's 5-second
 * transaction timeout, and atomicity is worthless here anyway — a half-cleared
 * dev database is fixed by running the seed again.
 *
 * Only the six roots are listed. Everything else is reached by `onDelete: Cascade`,
 * so this stays correct as the schema grows rather than needing a new line per
 * table. Users, roles and settings belong to `seed.ts` and are left untouched.
 */
async function reset(): Promise<void> {
  await prisma.searchQuery.deleteMany();
  // Cascades to variants, options, inventory, reviews, media joins, attributes,
  // relations, search documents, wishlist items and recently-viewed rows.
  await prisma.product.deleteMany();
  await prisma.collection.deleteMany();
  await prisma.category.deleteMany();
  await prisma.brand.deleteMany();
  await prisma.attributeDefinition.deleteMany();
  // Media is independent of Product, so it outlives the cascade above.
  await prisma.media.deleteMany();
}

async function seedTaxonomy() {
  const categoryIds = new Map<string, string>();

  for (const [index, spec] of CATEGORIES.entries()) {
    const parent = await prisma.category.create({
      data: {
        slug: spec.slug,
        name: spec.name,
        description: spec.description,
        heroHeadline: spec.heroHeadline,
        heroBody: spec.heroBody,
        path: `/${spec.slug}`,
        depth: 0,
        position: index,
        isActive: true,
      },
    });
    categoryIds.set(spec.slug, parent.id);

    for (const [childIndex, child] of (spec.children ?? []).entries()) {
      const created = await prisma.category.create({
        data: {
          parentId: parent.id,
          slug: `${spec.slug}-${child.slug}`,
          name: child.name,
          description: child.description,
          path: `/${spec.slug}/${child.slug}`,
          depth: 1,
          position: childIndex,
          isActive: true,
        },
      });
      // Keyed by the bare child slug for lookup from the product specs.
      categoryIds.set(`${spec.slug}/${child.slug}`, created.id);
    }
  }

  const brandIds = new Map<string, string>();
  for (const brand of BRANDS) {
    const created = await prisma.brand.create({ data: { ...brand, isActive: true } });
    brandIds.set(brand.slug, created.id);
  }

  const collectionIds = new Map<string, string>();
  for (const [index, collection] of COLLECTIONS.entries()) {
    const created = await prisma.collection.create({
      data: { ...collection, position: index, isActive: true },
    });
    collectionIds.set(collection.slug, created.id);
  }

  const attributeIds = new Map<string, string>();
  for (const attribute of ATTRIBUTES) {
    const created = await prisma.attributeDefinition.create({
      data: {
        key: attribute.key,
        label: attribute.label,
        type: attribute.type,
        unit: 'unit' in attribute ? (attribute.unit as string) : null,
        options: attribute.options,
        isFilterable: attribute.isFilterable,
        position: attribute.position,
        group: attribute.group,
      },
    });
    attributeIds.set(attribute.key, created.id);
  }

  const tagIds = new Map<string, string>();
  for (const tag of TAGS) {
    const created = await prisma.tag.upsert({
      where: { slug: tag.slug },
      update: { name: tag.name, isFilterable: tag.isFilterable },
      create: tag,
    });
    tagIds.set(tag.slug, created.id);
  }

  return { categoryIds, brandIds, collectionIds, attributeIds, tagIds };
}

type Taxonomy = Awaited<ReturnType<typeof seedTaxonomy>>;

async function seedProduct(spec: ProductSpec, taxonomy: Taxonomy, index: number): Promise<string> {
  const brandId = taxonomy.brandIds.get(spec.brand)!;
  const parentCategoryId = taxonomy.categoryIds.get(spec.category)!;
  const subcategoryId = spec.subcategory
    ? taxonomy.categoryIds.get(`${spec.category}/${spec.subcategory}`)
    : undefined;

  // The most specific category is the canonical one, so the product's URL is the
  // deepest sensible path rather than a top-level bucket.
  const primaryCategoryId = subcategoryId ?? parentCategoryId;

  const product = await prisma.product.create({
    data: {
      slug: spec.slug,
      name: spec.name,
      shortDescription: spec.shortDescription,
      description: spec.description,
      status: 'ACTIVE',
      brandId,
      primaryCategoryId,
      sku: `GT-${String(index + 1).padStart(4, '0')}`,
      features: spec.features,
      isFeatured: spec.featured ?? false,
      isNewArrival: spec.newArrival ?? false,
      isAdultOnly: true,
      currency: 'USD',
      publishedAt: new Date(Date.now() - randomInt(1, 240) * 86_400_000),
      shippingNote:
        'Ships free on orders over $75, from our US warehouse, in a plain unbranded box with no product detail on the label.',
      returnPolicyNote:
        'Unopened items can be returned within 30 days. For hygiene reasons opened items cannot be resold, but anything faulty is replaced under warranty.',
      attributes: {
        noiseDb: spec.noiseDb ?? null,
        runtimeMinutes: spec.runtimeMinutes ?? null,
        chargeMinutes: spec.chargeMinutes ?? null,
      },
      categories: {
        create: [
          { categoryId: parentCategoryId, position: 0 },
          ...(subcategoryId ? [{ categoryId: subcategoryId, position: 1 }] : []),
        ],
      },
      collections: {
        create: (spec.collections ?? []).map((slug, position) => ({
          collectionId: taxonomy.collectionIds.get(slug)!,
          position,
        })),
      },
      tags: {
        connect: spec.tags.map((slug) => ({ id: taxonomy.tagIds.get(slug)! })),
      },
    },
  });

  // --- Media -------------------------------------------------------------
  // `publicId` doubles as the deterministic seed for `MediaPlaceholder`, so the
  // gallery renders a stable image per product until real photography lands.
  const mediaCount = randomInt(3, 5);
  for (let position = 0; position < mediaCount; position += 1) {
    const media = await prisma.media.create({
      data: {
        type: 'IMAGE',
        publicId: `seed/${spec.slug}-${position}`,
        url: `https://res.cloudinary.com/demo/image/upload/seed/${spec.slug}-${position}.jpg`,
        alt: `${spec.name} — view ${position + 1}`,
        width: 1200,
        height: 1600,
        format: 'jpg',
        folder: 'products',
      },
    });
    await prisma.productMedia.create({
      data: { productId: product.id, mediaId: media.id, position },
    });
  }

  // --- Attributes --------------------------------------------------------
  const attributeValues: [string, string][] = [
    ['material', spec.material],
    ['power', spec.power],
    ['waterproof', spec.waterproof ? 'Yes' : 'No'],
    ['warranty', spec.power === 'Manual — no power' ? 'Lifetime on materials' : '2 years'],
    [
      'cleaning',
      spec.material === 'Platinum-cure silicone' || spec.material === '316L stainless steel'
        ? 'Boilable, or warm water and unscented soap'
        : 'Warm water and unscented soap',
    ],
  ];
  if (spec.noiseDb) attributeValues.push(['noise-level', String(spec.noiseDb)]);
  if (spec.runtimeMinutes) attributeValues.push(['runtime', String(spec.runtimeMinutes)]);
  if (spec.chargeMinutes) attributeValues.push(['charge-time', String(spec.chargeMinutes)]);

  await prisma.productAttribute.createMany({
    data: attributeValues.map(([key, value]) => ({
      productId: product.id,
      definitionId: taxonomy.attributeIds.get(key)!,
      value,
    })),
  });

  // --- Options and variants ---------------------------------------------
  const optionSpecs: { name: string; values: string[] }[] = [];
  if (spec.colors?.length) optionSpecs.push({ name: 'Colour', values: spec.colors });
  if (spec.sizes?.length) optionSpecs.push({ name: 'Size', values: spec.sizes });

  const optionValueIds = new Map<string, string>();
  for (const [position, option] of optionSpecs.entries()) {
    const created = await prisma.variantOption.create({
      data: { productId: product.id, name: option.name, position },
    });
    for (const [valuePosition, value] of option.values.entries()) {
      const createdValue = await prisma.variantOptionValue.create({
        data: { optionId: created.id, value, position: valuePosition },
      });
      optionValueIds.set(`${option.name}:${value}`, createdValue.id);
    }
  }

  // Cartesian product of the option axes, capped so a 3x3 product does not
  // generate nine variants of demo data.
  const combinations: string[][] = optionSpecs.length
    ? optionSpecs.reduce<string[][]>(
        (acc, option) => acc.flatMap((combo) => option.values.map((value) => [...combo, value])),
        [[]],
      )
    : [[]];

  const variantInputs = combinations.slice(0, 6);
  const createdVariants: {
    priceCents: number;
    salePriceCents: number | null;
    isActive: boolean;
  }[] = [];

  for (const [position, combination] of variantInputs.entries()) {
    // Larger sizes cost a little more, which is what real catalogues look like.
    const surcharge = position * 400;
    const priceCents = spec.priceCents + surcharge;
    const salePriceCents = spec.salePriceCents ? spec.salePriceCents + surcharge : null;

    const variantName = combination.length ? combination.join(' / ') : 'Default';

    const variant = await prisma.variant.create({
      data: {
        productId: product.id,
        sku: `${product.sku}-${position + 1}`,
        name: variantName,
        priceCents,
        salePriceCents,
        compareAtPriceCents: spec.compareAtPriceCents ? spec.compareAtPriceCents + surcharge : null,
        costCents: Math.round(priceCents * 0.42),
        weightGrams: randomInt(90, 640),
        lengthMm: randomInt(90, 240),
        widthMm: randomInt(30, 90),
        heightMm: randomInt(30, 90),
        insertableLengthMm: spec.insertableLengthMm ?? null,
        diameterMm: spec.diameterMm ?? null,
        position,
        isActive: true,
      },
    });

    createdVariants.push({ priceCents, salePriceCents, isActive: true });

    // Link the variant to the option values it represents.
    for (const [axisIndex, value] of combination.entries()) {
      const optionName = optionSpecs[axisIndex]!.name;
      await prisma.variantSelection.create({
        data: { variantId: variant.id, valueId: optionValueIds.get(`${optionName}:${value}`)! },
      });
    }

    // A deliberate spread of stock states so the listing exercises every badge.
    const quantity =
      position === variantInputs.length - 1 && index % 7 === 0 ? 0 : randomInt(0, 90);
    await prisma.inventory.create({
      data: {
        variantId: variant.id,
        quantity,
        reserved: quantity > 4 ? randomInt(0, 3) : 0,
        lowStockThreshold: 5,
        policy: 'DENY',
        location: 'default',
      },
    });
  }

  // --- Reviews -----------------------------------------------------------
  const reviewCount = randomInt(2, 7);
  const usedAuthors = new Set<string>();
  let ratingTotal = 0;

  for (let i = 0; i < reviewCount; i += 1) {
    const author = pick(REVIEW_AUTHORS);
    if (usedAuthors.has(author.name)) continue;
    usedAuthors.add(author.name);

    const template = pick(REVIEW_TEMPLATES);
    ratingTotal += template.rating;

    const review = await prisma.review.create({
      data: {
        productId: product.id,
        authorName: author.name,
        rating: template.rating,
        title: template.title,
        body: template.body,
        status: 'APPROVED',
        isVerifiedPurchase: true,
        helpfulCount: randomInt(0, 48),
        moderatedAt: new Date(),
        createdAt: new Date(Date.now() - randomInt(1, 200) * 86_400_000),
      },
    });

    // A minority of reviews carry photos, which is realistic.
    if (nextRandom() > 0.7) {
      await prisma.reviewImage.create({
        data: {
          reviewId: review.id,
          url: `https://res.cloudinary.com/demo/image/upload/seed/review-${review.id}.jpg`,
          publicId: `seed/review-${review.id}`,
          alt: `Customer photo of ${spec.name}`,
          width: 900,
          height: 900,
          position: 0,
        },
      });
    }
  }

  const approvedCount = usedAuthors.size;
  const ratingAverage = approvedCount ? ratingTotal / approvedCount : 0;

  // --- Denormalised rollups and facets ----------------------------------
  const range = priceRange(createdVariants);

  const facets = [
    facetToken('brand', spec.brand),
    facetToken('category', spec.category),
    ...(spec.subcategory ? [facetToken('category', `${spec.category}-${spec.subcategory}`)] : []),
    ...(spec.collections ?? []).map((slug) => facetToken('collection', slug)),
    ...(spec.colors ?? []).map((color) => facetToken('color', color)),
    ...(spec.sizes ?? []).map((size) => facetToken('size', size)),
    facetToken('material', spec.material),
    ...spec.tags.map((tag) => facetToken('tag', tag)),
    ...ratingFacetTokens(ratingAverage),
    ...(range.isOnSale ? [FLAG_FACETS.onSale] : []),
    ...(spec.newArrival ? [FLAG_FACETS.newArrival] : []),
    ...(spec.featured ? [FLAG_FACETS.featured] : []),
  ];

  await prisma.product.update({
    where: { id: product.id },
    data: {
      minPriceCents: range.minPriceCents,
      maxPriceCents: range.maxPriceCents,
      isOnSale: range.isOnSale,
      ratingAverage: Number(ratingAverage.toFixed(2)),
      ratingCount: approvedCount,
      viewCount: randomInt(120, 9800),
      soldCount: randomInt(5, 2400),
      facets: [...new Set(facets)],
    },
  });

  return product.id;
}

/**
 * Builds the search document.
 *
 * The title is repeated so a title hit outranks a body hit under the default
 * `ts_rank` without needing weighted vectors at query time.
 */
async function seedSearchDocuments(): Promise<void> {
  const products = await prisma.product.findMany({
    where: { status: 'ACTIVE' },
    select: {
      id: true,
      name: true,
      shortDescription: true,
      description: true,
      features: true,
      brand: { select: { name: true } },
      primaryCategory: { select: { name: true, path: true } },
      tags: { select: { name: true } },
      productAttributes: { select: { value: true, definition: { select: { label: true } } } },
    },
  });

  for (const product of products) {
    const keywords = [
      ...product.tags.map((tag) => tag.name),
      ...product.productAttributes.map((attribute) => attribute.value),
    ];

    const content = [
      product.name,
      product.name, // repeated: cheap title weighting
      product.brand?.name ?? '',
      product.primaryCategory?.name ?? '',
      product.shortDescription ?? '',
      product.features.join(' '),
      keywords.join(' '),
      product.description ?? '',
    ]
      .filter(Boolean)
      .join(' \n ');

    await prisma.productSearchDocument.create({
      data: {
        productId: product.id,
        title: product.name,
        brandName: product.brand?.name ?? null,
        categoryPath: product.primaryCategory?.path ?? null,
        keywords: [...new Set(keywords)],
        content,
      },
    });
  }
}

/** Related items within a category, plus a small frequently-bought-together set. */
async function seedRelations(): Promise<void> {
  const products = await prisma.product.findMany({
    select: { id: true, slug: true, primaryCategory: { select: { path: true } } },
  });

  const care = products.filter((p) =>
    ['tide-water-based-lubricant', 'reset-toy-cleaner'].includes(p.slug),
  );

  /** Top-level segment of the canonical path — `/vibrators/wands` -> `vibrators`. */
  const topLevel = (path: string | undefined) => path?.split('/').filter(Boolean)[0] ?? '';

  for (const product of products) {
    // Related within the *top-level* category, not the leaf. Relating only within
    // a narrow subcategory leaves single-product leaves with no relations at all.
    const siblings = products.filter(
      (other) =>
        other.id !== product.id &&
        topLevel(other.primaryCategory?.path) === topLevel(product.primaryCategory?.path),
    );

    const related = siblings.slice(0, 4);
    for (const [position, target] of related.entries()) {
      await prisma.productRelation.create({
        data: { productId: product.id, relatedId: target.id, type: 'RELATED', position },
      });
    }

    // Lubricant and cleaner genuinely are bought with almost everything.
    for (const [position, target] of care.entries()) {
      if (target.id === product.id) continue;
      await prisma.productRelation.create({
        data: {
          productId: product.id,
          relatedId: target.id,
          type: 'FREQUENTLY_BOUGHT_TOGETHER',
          position,
          score: 0.6 + position * 0.1,
        },
      });
    }
  }
}

/** Popular and trending suggestions read from this table. */
async function seedSearchQueries(): Promise<void> {
  const terms = [
    ['vibrator', 24],
    ['silicone dildo', 18],
    ['quiet vibrator', 15],
    ['water based lubricant', 14],
    ['beginner plug', 11],
    ['couples ring', 9],
    ['glass wand', 7],
    ['toy cleaner', 6],
    ['app controlled', 5],
    ['stainless steel plug', 4],
  ] as const;

  for (const [term, count] of terms) {
    for (let i = 0; i < count; i += 1) {
      await prisma.searchQuery.create({
        data: {
          term,
          resultCount: randomInt(2, 24),
          createdAt: new Date(Date.now() - randomInt(0, 20) * 3_600_000),
        },
      });
    }
  }

  // Zero-result queries, so the merchandising gap report has something in it.
  for (const term of ['leather harness', 'warming lube', 'kegel balls']) {
    await prisma.searchQuery.create({ data: { term, resultCount: 0 } });
  }
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_CATALOG_SEED !== 'true') {
    throw new Error(
      'Refusing to seed demo products in production. Set ALLOW_CATALOG_SEED=true if this is genuinely intended.',
    );
  }

  console.log('Clearing existing catalogue…');
  await reset();

  console.log('Seeding taxonomy…');
  const taxonomy = await seedTaxonomy();

  console.log(`Seeding ${PRODUCTS.length} products…`);
  for (const [index, spec] of PRODUCTS.entries()) {
    await seedProduct(spec, taxonomy, index);
    process.stdout.write('.');
  }
  process.stdout.write('\n');

  console.log('Building search documents…');
  await seedSearchDocuments();

  console.log('Linking related products…');
  await seedRelations();

  console.log('Seeding search telemetry…');
  await seedSearchQueries();

  const [products, variants, reviews, categories, documents] = await Promise.all([
    prisma.product.count(),
    prisma.variant.count(),
    prisma.review.count(),
    prisma.category.count(),
    prisma.productSearchDocument.count(),
  ]);

  console.log(
    `\nDone. ${products} products, ${variants} variants, ${categories} categories, ` +
      `${reviews} reviews, ${documents} search documents.`,
  );
}

main()
  .catch((error) => {
    console.error('\nCatalogue seed failed:', error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
