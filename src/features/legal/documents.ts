import { siteConfig } from '@/config/site';

/**
 * The two policies a customer agrees to before they can buy anything.
 *
 * ⚠️ DRAFTS. These are written to match what the system actually does, not
 * copied from a generator, but they have **not been reviewed by a lawyer** and
 * must be before launch. An adult-products retailer in the US has obligations —
 * age verification, state privacy statutes, card network rules — that vary by
 * state and change; this file is a starting point for that review, not a
 * substitute for it. See docs/quality.md.
 *
 * They live in code rather than a CMS deliberately. A CMS is phase 6 work, and
 * the register form links to these two documents *today* — it asks customers to
 * accept terms that returned a 404, which is the kind of gap that survives
 * because it is nobody's ticket.
 *
 * Everything here should stay true to the implementation. Where a claim is made
 * ("we never store your card number"), the code that makes it true is named in a
 * comment so the two can be checked against each other.
 */
export interface LegalSection {
  heading: string;
  paragraphs: string[];
  /** Rendered as a bulleted list under the paragraphs. */
  bullets?: string[];
}

export interface LegalDocument {
  slug: string;
  title: string;
  description: string;
  /** ISO date. Shown to the customer, because a policy with no date is unverifiable. */
  updated: string;
  intro: string;
  sections: LegalSection[];
}

const UPDATED = '2026-08-01';

const terms: LegalDocument = {
  slug: 'terms',
  title: 'Terms of Service',
  description: `The agreement between you and ${siteConfig.legalName} when you shop at ${siteConfig.name}.`,
  updated: UPDATED,
  intro: `These terms govern your use of ${siteConfig.name} and any order you place with ${siteConfig.legalName}. Placing an order means you accept them. If you do not, please do not use the site.`,
  sections: [
    {
      heading: 'You must be 18 or older',
      paragraphs: [
        `${siteConfig.name} sells products intended for adults. You may not use this site, create an account or place an order unless you are at least ${siteConfig.minimumAge} years old and legally able to enter into a contract where you live.`,
        'We ask you to confirm your age before browsing and again at checkout. Confirming falsely is a breach of these terms, and we may cancel any order and close any account where we have reasonable grounds to believe the customer is under age.',
      ],
    },
    {
      heading: 'Your account',
      paragraphs: [
        'You are responsible for keeping your password confidential and for activity under your account. Tell us promptly if you believe someone else has access.',
        'You can see every device signed in to your account, sign any of them out, and delete your account entirely from your account settings. Changing your password signs out every other device automatically.',
      ],
    },
    {
      heading: 'Orders, pricing and availability',
      paragraphs: [
        'An order is an offer to buy. We accept it when we send the confirmation email, and a contract forms at that point — not when payment is authorised.',
        'We may decline or cancel an order before dispatch if the item is unavailable, if the price or description was wrong, or if we suspect fraud. If we cancel after taking payment, we refund in full.',
        'Prices are in US dollars and exclude sales tax, which is calculated at checkout based on your delivery address. Shipping costs are shown before you pay. Nothing is charged that you have not seen first.',
      ],
    },
    {
      heading: 'Payment',
      paragraphs: [
        // payment.service.ts — Stripe Payment Intents; no PAN ever reaches our servers.
        'Card payments are processed by Stripe. Your card number never reaches our servers: we hold only a token that lets us charge the card you chose, and the last four digits and expiry so you can recognise it.',
        `Your statement will show a discreet descriptor, not the name of any product. We do not print product names on anything that leaves our building.`,
      ],
    },
    {
      heading: 'Delivery and packaging',
      paragraphs: [
        'Every order ships in plain, unbranded outer packaging with no indication of the contents or the retailer. The sender name on the label is neutral.',
        'Delivery estimates are estimates. Risk passes to you on delivery; title passes when we have been paid in full.',
      ],
    },
    {
      heading: 'Returns and hygiene',
      paragraphs: [
        'For hygiene reasons, intimate products cannot be returned once the sealed packaging has been opened. This is a health protection, not a policy preference, and it does not affect your rights where an item is faulty or not as described.',
        'Unopened items in original condition can be returned within 30 days. Faulty items can be returned regardless of whether the seal is broken — tell us what went wrong and we will make it right.',
      ],
    },
    {
      heading: 'Acceptable use',
      paragraphs: ['You agree not to:'],
      bullets: [
        'buy from us for resale without our written agreement',
        'use the site in any way that breaks the law where you are',
        'attempt to access another customer’s account or order',
        'scrape, probe or overload the site or its APIs',
        'submit reviews or content that are false, unlawful, or that identify another person without their consent',
      ],
    },
    {
      heading: 'Our content',
      paragraphs: [
        `The text, photography, product specifications and design of this site belong to ${siteConfig.legalName} or our suppliers. You may not copy or reuse them commercially without permission.`,
        'Reviews and content you submit remain yours. You give us a licence to display them on the site alongside the product.',
      ],
    },
    {
      heading: 'Product information and safety',
      paragraphs: [
        'We publish material composition, motor and charging details and measured decibel levels because they are how you judge whether a product suits you. We take care to keep them accurate.',
        'Our products are not medical devices and nothing on this site is medical advice. If you have a condition that might be affected, speak to a clinician. Follow the cleaning and material guidance supplied with each product — some materials and lubricants must not be combined.',
      ],
    },
    {
      heading: 'Liability',
      paragraphs: [
        'Nothing in these terms limits liability for death or personal injury caused by our negligence, for fraud, or for anything else that cannot lawfully be limited.',
        'Subject to that, our total liability for any order is limited to the amount you paid for it, and we are not liable for indirect or consequential loss.',
      ],
    },
    {
      heading: 'Privacy',
      paragraphs: [
        'How we handle your personal information is set out in our Privacy Policy, which forms part of these terms.',
      ],
    },
    {
      heading: 'Changes, law and contact',
      paragraphs: [
        'We may update these terms. The version in force for your order is the one published when you placed it, and the date at the top of this page tells you when it last changed.',
        'These terms are governed by the laws of the State of Delaware, without regard to conflict of laws rules.',
        `Questions: ${siteConfig.contact.email}, or ${siteConfig.contact.phone} (${siteConfig.contact.hours}).`,
      ],
    },
  ],
};

const privacy: LegalDocument = {
  slug: 'privacy',
  title: 'Privacy Policy',
  description: `What ${siteConfig.name} collects, why, and what you can do about it.`,
  updated: UPDATED,
  intro: `Buying from an adult retailer means trusting it with information you would not want shared. This page says exactly what ${siteConfig.legalName} collects, what we do with it, and how to get rid of it. It describes what the system actually does — not what a template says it might.`,
  sections: [
    {
      heading: 'What we collect',
      paragraphs: ['Only what an order or an account needs:'],
      bullets: [
        'Your name, email address and phone number, if you give it',
        'Delivery and billing addresses, stored as a snapshot on each order so a later edit cannot rewrite your history',
        'Order contents, totals and status',
        'A payment token from Stripe, plus the card brand, last four digits and expiry — never the full card number',
        'Your wishlist, recently viewed products and loyalty balance, if you have an account',
        'Sign-in records: date, IP address and browser, for every attempt, successful or not',
        'Marketing and notification preferences',
      ],
    },
    {
      heading: 'Why we keep sign-in records',
      paragraphs: [
        // security.service.ts — LoginEvent, shown on /account/security.
        'Failed sign-ins are the ones that matter. Three wrong passwords from a country you have never visited is a warning we can only give you if the failures were written down. You can see this history yourself on your security page, and every device currently signed in.',
      ],
    },
    {
      heading: 'Discretion',
      paragraphs: [
        'This is the part that matters most in this category, so it is specific:',
      ],
      bullets: [
        'Outer packaging is plain and unbranded, with a neutral sender name',
        'Your card statement shows a discreet descriptor, never a product name',
        'Emails we send use neutral subject lines',
        'We do not sell or rent your personal information, and we never have',
        'We do not share purchase history with advertising networks',
      ],
    },
    {
      heading: 'Who we share it with',
      paragraphs: [
        'Only the companies needed to complete your order, and only the data they need:',
      ],
      bullets: [
        'Stripe, to take payment',
        'Our delivery carrier, to get the parcel to you — they receive a name and address, not an order description',
        'Our email provider, to send order confirmations and any newsletter you asked for',
        'Our hosting and database providers, who store the data on our behalf',
      ],
    },
    {
      heading: 'Cookies',
      paragraphs: [
        'We use cookies that the site cannot work without: your session, your cart, your age confirmation. We do not set advertising cookies.',
      ],
    },
    {
      heading: 'How long we keep it',
      paragraphs: [
        'Order records are kept for seven years because tax and accounting rules require it. Everything else — wishlist, browsing history, marketing preferences — is kept until you delete your account or ask us to remove it.',
      ],
    },
    {
      heading: 'Your rights',
      paragraphs: [
        'Wherever you live in the US, you can ask us for a copy of what we hold, ask us to correct it, or ask us to delete it. Residents of California, Colorado, Connecticut, Virginia and other states with privacy statutes have these rights by law; we extend them to every customer because splitting them by state would be worse for everyone.',
        // profile.service.ts — deleteAccount().
        'You can delete your account yourself from your account settings, which removes your profile, addresses, wishlist and browsing history. Order records are retained for the period above, with your details reduced to what the tax rules require.',
        `To make any other request, email ${siteConfig.contact.email}.`,
      ],
    },
    {
      heading: 'Security',
      paragraphs: [
        'Passwords are hashed, never stored or recoverable in readable form — we cannot tell you your password because we do not know it. Traffic is encrypted in transit. Access to customer data is limited to staff who need it.',
      ],
    },
    {
      heading: 'Children',
      paragraphs: [
        `This site is for adults aged ${siteConfig.minimumAge} and over. We do not knowingly collect information from anyone younger, and we delete it if we discover we have.`,
      ],
    },
    {
      heading: 'Changes and contact',
      paragraphs: [
        'If we change this policy in a way that affects how we use information we already hold, we will tell account holders by email rather than quietly editing this page.',
        `Questions or requests: ${siteConfig.contact.email}, or ${siteConfig.contact.phone} (${siteConfig.contact.hours}).`,
      ],
    },
  ],
};

/**
 * Published documents, by slug.
 *
 * Only these two exist. The footer links to a dozen more `/pages/*` routes that
 * are phase 6 content work — those still 404, deliberately and on record, in
 * docs/quality.md. These two are here early because the register form makes
 * customers agree to them, and agreeing to a 404 is not agreeing to anything.
 */
export const LEGAL_DOCUMENTS: Record<string, LegalDocument> = {
  [terms.slug]: terms,
  [privacy.slug]: privacy,
};

export const LEGAL_SLUGS = Object.keys(LEGAL_DOCUMENTS);

export function getLegalDocument(slug: string): LegalDocument | null {
  return LEGAL_DOCUMENTS[slug] ?? null;
}
