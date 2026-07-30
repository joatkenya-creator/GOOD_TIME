import Script from 'next/script';

import { publicEnv } from '@/lib/env.public';

/**
 * Analytics tags: GA4 and Microsoft Clarity.
 *
 * Both load with `strategy="afterInteractive"`, so neither blocks first paint or
 * competes with the LCP image for bandwidth. Each renders only when its ID is
 * configured, which keeps local development free of third-party requests.
 *
 * Google Search Console needs no script — it is verified via the `verification`
 * meta tag emitted by `buildRootMetadata`, or via DNS.
 */
export function Analytics() {
  const ga4 = publicEnv.NEXT_PUBLIC_GA4_MEASUREMENT_ID;
  const clarity = publicEnv.NEXT_PUBLIC_CLARITY_PROJECT_ID;

  return (
    <>
      {ga4 ? (
        <>
          <Script
            src={`https://www.googletagmanager.com/gtag/js?id=${ga4}`}
            strategy="afterInteractive"
          />
          <Script id="ga4-init" strategy="afterInteractive">
            {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}
gtag('js',new Date());
gtag('config','${ga4}',{send_page_view:true});`}
          </Script>
        </>
      ) : null}

      {clarity ? (
        <Script id="clarity-init" strategy="afterInteractive">
          {`(function(c,l,a,r,i,t,y){c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y)})(window,document,"clarity","script","${clarity}");`}
        </Script>
      ) : null}
    </>
  );
}
