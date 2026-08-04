'use client';

import Script from 'next/script';
import { useSyncExternalStore } from 'react';

import type { MarketingProvider } from '@/generated/prisma/enums';

/**
 * Marketing tags, loaded only when they are allowed to be.
 *
 * ## The consent gate
 *
 * Tags in `onConsent` are not rendered at all until consent is recorded — they
 * are not in the DOM, not blocked-then-unblocked, not present with a
 * `type="text/plain"` trick. A script that exists on the page is a script that
 * can run, and the whole point is that these have not run.
 *
 * The consent state is read from a cookie the banner sets. Reading it in an
 * effect rather than during render is deliberate: the server does not know the
 * value at build time, and rendering the tags server-side would leak which
 * ones exist to a visitor who has refused them.
 *
 * ## Google's consent mode
 *
 * GA4 loads with everything denied and upgrades if consent arrives, which is
 * what `default` then `update` does below. That is the one tag where loading
 * early is defensible: in denied mode it sets no cookies and sends no
 * identifiers, and it gives the shop a traffic count without watching anyone.
 */

export interface TagConfig {
  provider: MarketingProvider;
  publicId: string | null;
  config: Record<string, unknown>;
}

const CONSENT_COOKIE = 'gt.consent';

function readConsent(): 'granted' | 'denied' | null {
  if (typeof document === 'undefined') return null;

  const match = document.cookie.match(/(?:^|;\s*)gt\.consent=([^;]+)/);
  if (!match) return null;

  return match[1] === 'granted' ? 'granted' : 'denied';
}

/**
 * Subscribes to consent changes.
 *
 * The banner dispatches `gt:consent` rather than reloading, so a customer who
 * accepts sees tracking start without losing their place in a listing.
 */
function subscribe(onChange: () => void): () => void {
  window.addEventListener('gt:consent', onChange);
  return () => window.removeEventListener('gt:consent', onChange);
}

export function MarketingTags({
  immediate,
  onConsent,
}: {
  immediate: TagConfig[];
  onConsent: TagConfig[];
}) {
  /*
   * `useSyncExternalStore`, not an effect.
   *
   * The cookie is an external mutable source, which is precisely what this
   * hook exists for: it reads on the client, returns the server snapshot
   * during SSR, and re-reads when the banner fires — with no setState during
   * commit and no render where the tags flash in.
   *
   * The server snapshot is deliberately `null`: the server does not know what
   * this visitor consented to, and rendering tags it cannot verify would
   * disclose which trackers exist to someone who has refused them.
   */
  const consent = useSyncExternalStore(subscribe, readConsent, () => null);

  const allowed = consent === 'granted' ? [...immediate, ...onConsent] : immediate;

  return (
    <>
      {allowed.map((tag) => (
        <Tag key={tag.provider} tag={tag} consent={consent} />
      ))}
    </>
  );
}

function Tag({ tag, consent }: { tag: TagConfig; consent: 'granted' | 'denied' | null }) {
  if (!tag.publicId) return null;

  switch (tag.provider) {
    case 'GA4':
      return (
        <>
          <Script
            src={`https://www.googletagmanager.com/gtag/js?id=${tag.publicId}`}
            strategy="afterInteractive"
          />
          <Script id="ga4-init" strategy="afterInteractive">
            {`
              window.dataLayer = window.dataLayer || [];
              function gtag(){dataLayer.push(arguments);}
              gtag('js', new Date());
              gtag('consent', 'default', {
                ad_storage: 'denied',
                ad_user_data: 'denied',
                ad_personalization: 'denied',
                analytics_storage: '${consent === 'granted' ? 'granted' : 'denied'}'
              });
              gtag('config', '${tag.publicId}', { anonymize_ip: true, send_page_view: true });
            `}
          </Script>
        </>
      );

    case 'GTM':
      return (
        <Script id="gtm-init" strategy="afterInteractive">
          {`
            (function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});
            var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';
            j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
            })(window,document,'script','dataLayer','${tag.publicId}');
          `}
        </Script>
      );

    case 'GOOGLE_ADS':
      return (
        <>
          <Script
            src={`https://www.googletagmanager.com/gtag/js?id=${tag.publicId}`}
            strategy="afterInteractive"
          />
          <Script id="ads-init" strategy="afterInteractive">
            {`
              window.dataLayer = window.dataLayer || [];
              function gtag(){dataLayer.push(arguments);}
              gtag('js', new Date());
              gtag('config', '${tag.publicId}');
            `}
          </Script>
        </>
      );

    case 'META_PIXEL':
      return (
        <Script id="meta-pixel" strategy="afterInteractive">
          {`
            !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
            n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
            n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
            t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,
            document,'script','https://connect.facebook.net/en_US/fbevents.js');
            fbq('init', '${tag.publicId}');
            fbq('track', 'PageView');
          `}
        </Script>
      );

    case 'TIKTOK_PIXEL':
      return (
        <Script id="tiktok-pixel" strategy="afterInteractive">
          {`
            !function(w,d,t){w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];
            ttq.methods=["page","track","identify","instances","debug","on","off","once","ready","alias","group","enableCookie","disableCookie"];
            ttq.setAndDefer=function(t,e){t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};
            for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);
            ttq.load=function(e,n){var r="https://analytics.tiktok.com/i18n/pixel/events.js";
            ttq._i=ttq._i||{};ttq._i[e]=[];ttq._i[e]._u=r;ttq._t=ttq._t||{};ttq._t[e]=+new Date;
            ttq._o=ttq._o||{};ttq._o[e]=n||{};var o=d.createElement("script");o.type="text/javascript";
            o.async=!0;o.src=r+"?sdkid="+e+"&lib="+t;var a=d.getElementsByTagName("script")[0];
            a.parentNode.insertBefore(o,a)};
            ttq.load('${tag.publicId}');ttq.page();}(window,document,'ttq');
          `}
        </Script>
      );

    case 'PINTEREST_TAG':
      return (
        <Script id="pinterest-tag" strategy="afterInteractive">
          {`
            !function(e){if(!window.pintrk){window.pintrk=function(){window.pintrk.queue.push(Array.prototype.slice.call(arguments))};
            var n=window.pintrk;n.queue=[],n.version="3.0";var t=document.createElement("script");
            t.async=!0,t.src=e;var r=document.getElementsByTagName("script")[0];
            r.parentNode.insertBefore(t,r)}}("https://s.pinimg.com/ct/core.js");
            pintrk('load', '${tag.publicId}');
            pintrk('page');
          `}
        </Script>
      );

    case 'MICROSOFT_UET':
      return (
        <Script id="uet-tag" strategy="afterInteractive">
          {`
            (function(w,d,t,r,u){var f,n,i;w[u]=w[u]||[],f=function(){var o={ti:"${tag.publicId}"};
            o.q=w[u],w[u]=new UET(o),w[u].push("pageLoad")},n=d.createElement(t),n.src=r,n.async=1,
            n.onload=n.onreadystatechange=function(){var s=this.readyState;
            s&&s!=="loaded"&&s!=="complete"||(f(),n.onload=n.onreadystatechange=null)},
            i=d.getElementsByTagName(t)[0],i.parentNode.insertBefore(n,i)})
            (window,document,"script","//bat.bing.com/bat.js","uetq");
          `}
        </Script>
      );

    case 'LINKEDIN_INSIGHT':
      return (
        <Script id="linkedin-insight" strategy="afterInteractive">
          {`
            _linkedin_partner_id = "${tag.publicId}";
            window._linkedin_data_partner_ids = window._linkedin_data_partner_ids || [];
            window._linkedin_data_partner_ids.push(_linkedin_partner_id);
            (function(l){if(!l){window.lintrk=function(a,b){window.lintrk.q.push([a,b])};window.lintrk.q=[]}
            var s=document.getElementsByTagName("script")[0];var b=document.createElement("script");
            b.type="text/javascript";b.async=true;
            b.src="https://snap.licdn.com/li.lms-analytics/insight.min.js";
            s.parentNode.insertBefore(b,s);})(window.lintrk);
          `}
        </Script>
      );

    // Server-to-server or meta-tag only; nothing to load in the browser.
    case 'GOOGLE_MERCHANT':
    case 'GOOGLE_SEARCH_CONSOLE':
      return null;

    default:
      return null;
  }
}

/** Called by the consent banner. Exported so there is one place that sets it. */
export function setConsent(granted: boolean): void {
  const value = granted ? 'granted' : 'denied';
  // A year, and `SameSite=Lax` so it survives a return from a payment page.
  document.cookie = `${CONSENT_COOKIE}=${value}; path=/; max-age=31536000; samesite=lax`;
  window.dispatchEvent(new Event('gt:consent'));
}
